/**
 * WCH DLL Backend Implementation
 *
 * Uses WCH's proprietary CH347DLL.dll to communicate with CH347 devices.
 * Windows only. Requires koffi and the DLL from WCH.
 */

import { CH347Backend } from './backend';
import { CH347WCH, isWCHDLLAvailable, loadWCHDLL } from './wch-dll';
import { SPIConfig, GPIOState, GPIOConfig, CH347DeviceInfo } from './types';
import { CH347_GPIO_COUNT, CH347_MAX_DATA_LEN, CH347_VID, CH347_PID_SPI_I2C_UART, DEFAULT_SPI_CONFIG, delay } from './constants';

/**
 * WCH DLL-based backend for CH347
 */
export class WCHBackend implements CH347Backend {
  private wch: CH347WCH | null = null;
  private spiConfig: SPIConfig = { ...DEFAULT_SPI_CONFIG };
  private _spiInitialized = false;
  private pinStates: GPIOState[] = [];

  constructor(config?: Partial<SPIConfig>) {
    if (config) {
      this.spiConfig = { ...this.spiConfig, ...config };
    }

    // Initialize pin states cache
    for (let i = 0; i < CH347_GPIO_COUNT; i++) {
      this.pinStates[i] = {
        pin: i,
        direction: 'input',
        value: false,
      };
    }
  }

  /**
   * List all connected CH347 devices
   */
  static async listDevices(): Promise<CH347DeviceInfo[]> {
    const deviceIndices = await CH347WCH.listDevices();
    return deviceIndices.map((deviceIndex) => ({
      vendorId: CH347_VID,
      productId: CH347_PID_SPI_I2C_UART,
      busNumber: 0,
      deviceAddress: deviceIndex,
    }));
  }

  /**
   * Check if the backend is available
   */
  static isAvailable(): boolean {
    return isWCHDLLAvailable();
  }

  // ==================== Device Management ====================

  async open(deviceIndex = 0): Promise<void> {
    if (!loadWCHDLL()) {
      throw new Error(
        'WCH DLL not available. Install koffi (npm install koffi) and ' +
        'download CH347DLL.dll from: https://www.wch.cn/downloads/CH341PAR_ZIP.html'
      );
    }

    this.wch = new CH347WCH();
    await this.wch.open(deviceIndex);

    // Auto-initialize SPI with config
    await this.wch.spiInit(this.spiConfig);
    this._spiInitialized = true;
  }

  async close(): Promise<void> {
    if (this.wch) {
      await this.wch.close();
      this.wch = null;
    }
    this._spiInitialized = false;
  }

  isConnected(): boolean {
    return this.wch?.isConnected() ?? false;
  }

  getUARTPath(): string | null {
    // WCH DLL doesn't provide UART path discovery
    return null;
  }

  // ==================== SPI Operations ====================

  async spiInit(config?: Partial<SPIConfig>): Promise<void> {
    if (!this.wch) {
      throw new Error('Device not open');
    }

    if (config) {
      this.spiConfig = { ...this.spiConfig, ...config };
    }

    await this.wch.spiInit(this.spiConfig);
    this._spiInitialized = true;
  }

  spiGetConfig(): SPIConfig {
    return { ...this.spiConfig };
  }

  spiIsInitialized(): boolean {
    return this._spiInitialized;
  }

  async spiTransfer(writeData: Buffer, readLength?: number): Promise<Buffer> {
    if (!this.wch) {
      throw new Error('Device not open');
    }

    const len = readLength ?? writeData.length;
    if (len === writeData.length) {
      return await this.wch.spiTransfer(writeData);
    }

    // If different lengths, pad or truncate
    const buffer = Buffer.alloc(Math.max(writeData.length, len));
    writeData.copy(buffer);
    const result = await this.wch.spiTransfer(buffer);
    return result.subarray(0, len);
  }

  /**
   * Send SPI command - matches libusb sendCommand() behavior
   *
   * Uses the same USB command sequence as the libusb backend:
   * - Write-only (readLength=0): 0xC1 assert → 0xC4 write → 0xC1 deassert
   * - Write-then-read: 0xC1 assert → 0xC4 write → 0xC3 read → 0xC1 deassert
   *
   * This is implemented via:
   * - CH347SPI_Write for write-only operations
   * - CH347SPI_Read for write-then-read operations
   */
  async spiSendCommand(writeData: Buffer, readLength = 0): Promise<Buffer> {
    if (!this.wch) {
      throw new Error('Device not open');
    }

    // For large reads, chunk the operation so each sub-read fits within
    // a single DLL internal USB packet. The DLL's CH347SPI_WriteRead chunks
    // at ~507 bytes (CH347_MAX_DATA_LEN) and toggles CS between chunks.
    // If cmd + readLen exceeds this limit, CS gets deasserted mid-read,
    // corrupting the last bytes of each chunk.
    // Fix: max readLen per sub-read = CH347_MAX_DATA_LEN - cmdLen
    const maxReadPerChunk = CH347_MAX_DATA_LEN - writeData.length;

    if (writeData.length >= 1 && readLength > maxReadPerChunk) {
      const cmd = writeData[0];
      const address = writeData.length >= 4
        ? (writeData[1] << 16) | (writeData[2] << 8) | writeData[3]
        : 0;

      const result = Buffer.alloc(readLength);
      let offset = 0;

      while (offset < readLength) {
        const chunkLen = Math.min(maxReadPerChunk, readLength - offset);
        const chunkAddr = address + offset;

        // Build command for this chunk
        const chunkCmd = Buffer.alloc(writeData.length);
        chunkCmd[0] = cmd;
        if (writeData.length >= 4) {
          chunkCmd[1] = (chunkAddr >> 16) & 0xff;
          chunkCmd[2] = (chunkAddr >> 8) & 0xff;
          chunkCmd[3] = chunkAddr & 0xff;
        }

        const chunkResult = await this.wch.sendCommand(chunkCmd, chunkLen);
        chunkResult.copy(result, offset);

        offset += chunkLen;
      }

      return result;
    }

    // Use the new sendCommand method which matches libusb behavior:
    // - readLength=0: uses CH347SPI_Write (sends 0xC4 command)
    // - readLength>0: uses CH347SPI_Read (sends 0xC4 then 0xC3)
    return await this.wch.sendCommand(writeData, readLength);
  }

  /**
   * Bulk read from SPI flash - matches libusb spiBulkRead() behavior
   *
   * Uses CH347SPI_Read which sends the same USB sequence as libusb:
   *   0xC1 assert → 0xC4 write cmd → 0xC3 read data → 0xC1 deassert
   */
  async spiBulkRead(address: number, length: number, readCmd = 0x03): Promise<Buffer> {
    if (!this.wch) {
      throw new Error('Device not open');
    }

    // Chunk reads so cmd + data fits in one DLL internal USB packet.
    // DLL toggles CS between internal chunks, so total must be <= CH347_MAX_DATA_LEN.
    const maxChunk = CH347_MAX_DATA_LEN - 4; // 4 bytes for cmd + 24-bit address
    const result = Buffer.alloc(length);
    let offset = 0;

    while (offset < length) {
      const chunkLen = Math.min(maxChunk, length - offset);
      const chunkAddr = address + offset;

      // Build read command: cmd + 24-bit address
      const chunkCmd = Buffer.alloc(4);
      chunkCmd[0] = readCmd;
      chunkCmd[1] = (chunkAddr >> 16) & 0xff;
      chunkCmd[2] = (chunkAddr >> 8) & 0xff;
      chunkCmd[3] = chunkAddr & 0xff;

      const chunkData = await this.wch.sendCommand(chunkCmd, chunkLen);
      chunkData.copy(result, offset);
      offset += chunkLen;
    }

    return result;
  }

  // ==================== GPIO Operations ====================

  async gpioReadAll(): Promise<GPIOState[]> {
    if (!this.wch) {
      throw new Error('Device not open');
    }

    this.pinStates = await this.wch.gpioReadAll();
    return [...this.pinStates];
  }

  async gpioRead(pin: number): Promise<GPIOState> {
    if (!this.wch) {
      throw new Error('Device not open');
    }

    if (pin < 0 || pin >= CH347_GPIO_COUNT) {
      throw new Error(`Invalid pin number: ${pin}`);
    }

    return await this.wch.gpioRead(pin);
  }

  async gpioWrite(pin: number, value: boolean): Promise<void> {
    if (!this.wch) {
      throw new Error('Device not open');
    }

    if (pin < 0 || pin >= CH347_GPIO_COUNT) {
      throw new Error(`Invalid pin number: ${pin}`);
    }

    await this.wch.gpioWrite(pin, value);
    this.pinStates[pin] = {
      pin,
      direction: 'output',
      value,
    };
  }

  async gpioWriteMultiple(pins: { pin: number; value: boolean }[]): Promise<void> {
    if (!this.wch) {
      throw new Error('Device not open');
    }

    // Get current GPIO state
    const { direction, value: currentValue } = await this.wch.gpioGet();

    // Build bitmasks for atomic update
    let enable = 0;
    let newDir = direction;
    let newValue = currentValue;

    for (const { pin, value } of pins) {
      if (pin < 0 || pin >= CH347_GPIO_COUNT) {
        throw new Error(`Invalid pin number: ${pin}`);
      }
      enable |= 1 << pin;
      newDir |= 1 << pin; // Set as output
      if (value) {
        newValue |= 1 << pin;
      } else {
        newValue &= ~(1 << pin);
      }
    }

    // Single atomic GPIO update
    await this.wch.gpioSet(enable, newDir, newValue);

    // Update cached states
    for (const { pin, value } of pins) {
      this.pinStates[pin] = {
        pin,
        direction: 'output',
        value,
      };
    }
  }

  async gpioSetDirection(pin: number, direction: 'input' | 'output'): Promise<void> {
    if (!this.wch) {
      throw new Error('Device not open');
    }

    if (pin < 0 || pin >= CH347_GPIO_COUNT) {
      throw new Error(`Invalid pin number: ${pin}`);
    }

    // WCH DLL sets direction when writing
    // For input, we just read the pin
    if (direction === 'output') {
      // Set as output with current cached value
      await this.wch.gpioWrite(pin, this.pinStates[pin]?.value ?? false);
    }

    // Update cached state
    this.pinStates[pin] = {
      ...this.pinStates[pin],
      direction,
    };
  }

  async gpioConfigure(configs: GPIOConfig[]): Promise<void> {
    if (!this.wch) {
      throw new Error('Device not open');
    }

    // Get current GPIO state
    const { direction, value: currentValue } = await this.wch.gpioGet();

    // Build bitmasks for atomic update
    let enable = 0;
    let newDir = direction;
    let newValue = currentValue;

    for (const config of configs) {
      if (config.pin < 0 || config.pin >= CH347_GPIO_COUNT) {
        throw new Error(`Invalid pin number: ${config.pin}`);
      }
      enable |= 1 << config.pin;

      if (config.direction === 'output') {
        newDir |= 1 << config.pin;
        if (config.value) {
          newValue |= 1 << config.pin;
        } else {
          newValue &= ~(1 << config.pin);
        }
      } else {
        newDir &= ~(1 << config.pin);
      }
    }

    // Single atomic GPIO update
    await this.wch.gpioSet(enable, newDir, newValue);

    // Update cached states
    for (const config of configs) {
      this.pinStates[config.pin] = {
        pin: config.pin,
        direction: config.direction,
        value: config.direction === 'output' ? (config.value ?? false) : this.pinStates[config.pin]?.value ?? false,
      };
    }
  }

  async gpioPulse(pin: number, durationMs = 100, activeHigh = true): Promise<void> {
    await this.gpioWrite(pin, activeHigh);
    await delay(durationMs);
    await this.gpioWrite(pin, !activeHigh);
  }

  async gpioToggle(pin: number): Promise<boolean> {
    const state = await this.gpioRead(pin);
    const newValue = !state.value;
    await this.gpioWrite(pin, newValue);
    return newValue;
  }
}
