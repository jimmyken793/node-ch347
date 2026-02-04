/**
 * WCH DLL Backend Implementation
 *
 * Uses WCH's proprietary CH347DLL.dll to communicate with CH347 devices.
 * Windows only. Requires koffi and the DLL from WCH.
 */

import { CH347Backend } from './backend';
import { CH347WCH, isWCHDLLAvailable, loadWCHDLL } from './wch-dll';
import { SPIConfig, GPIOState, GPIOConfig } from './types';
import { SPISpeed, SPIMode, CH347_GPIO_COUNT, CH347_PACKET_SIZE } from './constants';

const DEFAULT_SPI_CONFIG: SPIConfig = {
  speed: SPISpeed.CLK_15M,
  mode: SPIMode.MODE_0,
  chipSelect: 0,
  bitOrder: 'MSB',
};

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
  static listDevices(): number[] {
    return CH347WCH.listDevices();
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
    this.wch.open(deviceIndex);

    // Auto-initialize SPI with config
    this.wch.spiInit(this.spiConfig);
    this._spiInitialized = true;
  }

  close(): void {
    if (this.wch) {
      this.wch.close();
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

    this.wch.spiInit(this.spiConfig);
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
      return this.wch.spiTransfer(writeData);
    }

    // If different lengths, pad or truncate
    const buffer = Buffer.alloc(Math.max(writeData.length, len));
    writeData.copy(buffer);
    const result = this.wch.spiTransfer(buffer);
    return result.subarray(0, len);
  }

  async spiSendCommand(writeData: Buffer, readLength = 0): Promise<Buffer> {
    if (!this.wch) {
      throw new Error('Device not open');
    }

    // Reference: WCH SPI_Flash.cpp uses three different DLL functions:
    // - CH347SPI_WriteRead: Short commands with response (JEDEC ID, status read, WREN, etc.)
    // - CH347SPI_Write: Page program operations (bulk write)
    // - CH347SPI_Read: Bulk data reads from flash
    //
    // This matches the official WCH implementation pattern for optimal performance.

    if (readLength === 0 && writeData.length > 4) {
      // Page program operation - use CH347SPI_Write for optimal performance
      this.wch.spiWrite(writeData);
      return Buffer.alloc(0);
    }

    // For large reads, chunk using CH347SPI_WriteRead (proven working method)
    // TODO: Investigate CH347SPI_Read for potential performance improvements
    const MAX_TRANSFER_SIZE = CH347_PACKET_SIZE - 10; // Leave some margin for safety

    if (writeData.length + readLength > MAX_TRANSFER_SIZE) {
      // Large read operation - chunk the read portion
      // This happens for data reads (cmd=0x03 or similar with 24-bit address)
      if (writeData.length === 4 && readLength > 0) {
        // Extract command and address
        const cmd = writeData[0];
        const address = (writeData[1] << 16) | (writeData[2] << 8) | writeData[3];

        // Chunk the read operation to stay within USB packet size
        const maxChunk = MAX_TRANSFER_SIZE - 4; // Leave room for command
        const result = Buffer.alloc(readLength);
        let offset = 0;

        while (offset < readLength) {
          const chunkLen = Math.min(maxChunk, readLength - offset);
          const chunkAddr = address + offset;

          // Build command for this chunk
          const chunkCmd = Buffer.alloc(4);
          chunkCmd[0] = cmd;
          chunkCmd[1] = (chunkAddr >> 16) & 0xff;
          chunkCmd[2] = (chunkAddr >> 8) & 0xff;
          chunkCmd[3] = chunkAddr & 0xff;

          // Read this chunk using CH347SPI_WriteRead
          const chunkBuffer = Buffer.alloc(4 + chunkLen);
          chunkCmd.copy(chunkBuffer);
          const chunkResult = this.wch.spiTransfer(chunkBuffer);
          chunkResult.subarray(4).copy(result, offset);

          offset += chunkLen;
        }

        return result;
      }

      throw new Error(`Transfer too large for single operation: write=${writeData.length}, read=${readLength}`);
    }

    // All other commands use CH347SPI_WriteRead:
    // - Commands with response (JEDEC ID, status read, small data reads)
    // - Short write-only commands (WREN, WRDI, erase commands ≤ 4 bytes)
    const buffer = Buffer.alloc(writeData.length + readLength);
    writeData.copy(buffer);

    const result = this.wch.spiTransfer(buffer);
    return result.subarray(writeData.length);
  }

  async spiBulkRead(address: number, length: number, readCmd = 0x03): Promise<Buffer> {
    if (!this.wch) {
      throw new Error('Device not open');
    }

    // Build read command: cmd + 24-bit address
    const cmd = Buffer.alloc(4);
    cmd[0] = readCmd;
    cmd[1] = (address >> 16) & 0xff;
    cmd[2] = (address >> 8) & 0xff;
    cmd[3] = address & 0xff;

    // For large reads, we need to chunk
    const maxChunk = CH347_PACKET_SIZE - 4; // Leave room for command
    const result = Buffer.alloc(length);
    let offset = 0;

    while (offset < length) {
      const chunkLen = Math.min(maxChunk, length - offset);
      const chunkAddr = address + offset;

      const chunkCmd = Buffer.alloc(4);
      chunkCmd[0] = readCmd;
      chunkCmd[1] = (chunkAddr >> 16) & 0xff;
      chunkCmd[2] = (chunkAddr >> 8) & 0xff;
      chunkCmd[3] = chunkAddr & 0xff;

      const chunkData = await this.spiSendCommand(chunkCmd, chunkLen);
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

    this.pinStates = this.wch.gpioReadAll();
    return [...this.pinStates];
  }

  async gpioRead(pin: number): Promise<GPIOState> {
    if (!this.wch) {
      throw new Error('Device not open');
    }

    if (pin < 0 || pin >= CH347_GPIO_COUNT) {
      throw new Error(`Invalid pin number: ${pin}`);
    }

    return this.wch.gpioRead(pin);
  }

  async gpioWrite(pin: number, value: boolean): Promise<void> {
    if (!this.wch) {
      throw new Error('Device not open');
    }

    if (pin < 0 || pin >= CH347_GPIO_COUNT) {
      throw new Error(`Invalid pin number: ${pin}`);
    }

    this.wch.gpioWrite(pin, value);
    this.pinStates[pin] = {
      pin,
      direction: 'output',
      value,
    };
  }

  async gpioWriteMultiple(pins: { pin: number; value: boolean }[]): Promise<void> {
    for (const { pin, value } of pins) {
      await this.gpioWrite(pin, value);
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
      this.wch.gpioWrite(pin, this.pinStates[pin]?.value ?? false);
    }

    // Update cached state
    this.pinStates[pin] = {
      ...this.pinStates[pin],
      direction,
    };
  }

  async gpioConfigure(configs: GPIOConfig[]): Promise<void> {
    for (const config of configs) {
      if (config.direction === 'output') {
        await this.gpioWrite(config.pin, config.value ?? false);
      } else {
        await this.gpioSetDirection(config.pin, 'input');
      }
    }
  }

  async gpioPulse(pin: number, durationMs = 100, activeHigh = true): Promise<void> {
    await this.gpioWrite(pin, activeHigh);
    await this.delay(durationMs);
    await this.gpioWrite(pin, !activeHigh);
  }

  async gpioToggle(pin: number): Promise<boolean> {
    const state = await this.gpioRead(pin);
    const newValue = !state.value;
    await this.gpioWrite(pin, newValue);
    return newValue;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
