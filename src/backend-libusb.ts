/**
 * LibUSB Backend Implementation
 *
 * Uses libusb (via node-usb) to communicate with CH347 devices.
 * Works on Linux, macOS, and Windows (with UsbDk or WinUSB driver).
 */

import { CH347Backend } from './backend';
import { CH347USB } from './usb';
import { CH347SPI } from './spi';
import { CH347GPIO } from './gpio';
import { SPIConfig, GPIOState, GPIOConfig, CH347DeviceInfo } from './types';
import { SPISpeed, SPIMode, CH347_PACKET_SIZE } from './constants';

const DEFAULT_SPI_CONFIG: SPIConfig = {
  speed: SPISpeed.CLK_15M,
  mode: SPIMode.MODE_0,
  chipSelect: 0,
  bitOrder: 'MSB',
};

/**
 * LibUSB-based backend for CH347
 */
export class LibUSBBackend implements CH347Backend {
  private usb: CH347USB | null = null;
  private spi: CH347SPI | null = null;
  private gpio: CH347GPIO | null = null;
  private spiConfig: SPIConfig = { ...DEFAULT_SPI_CONFIG };
  private _spiInitialized = false;

  /**
   * List all connected CH347 devices
   */
  static listDevices(): CH347DeviceInfo[] {
    return CH347USB.listDevices();
  }

  /**
   * Check if the backend is available
   */
  static isAvailable(): boolean {
    try {
      // Try to list devices - if libusb works, we're available
      CH347USB.listDevices();
      return true;
    } catch {
      return false;
    }
  }

  // ==================== Device Management ====================

  async open(deviceIndex = 0): Promise<void> {
    this.usb = new CH347USB();
    await this.usb.open(deviceIndex);

    this.gpio = new CH347GPIO(this.usb);
    this.spi = new CH347SPI(this.usb, this.spiConfig);
  }

  close(): void {
    if (this.usb) {
      this.usb.close();
      this.usb = null;
    }
    this.spi = null;
    this.gpio = null;
    this._spiInitialized = false;
  }

  isConnected(): boolean {
    return this.usb?.isConnected() ?? false;
  }

  getUARTPath(): string | null {
    return this.usb?.getUARTPath() ?? null;
  }

  // ==================== SPI Operations ====================

  async spiInit(config?: Partial<SPIConfig>): Promise<void> {
    if (!this.spi) {
      throw new Error('Device not open');
    }

    if (config) {
      this.spiConfig = { ...this.spiConfig, ...config };
    }

    await this.spi.init(this.spiConfig);
    this._spiInitialized = true;
  }

  spiGetConfig(): SPIConfig {
    return { ...this.spiConfig };
  }

  spiIsInitialized(): boolean {
    return this._spiInitialized;
  }

  async spiTransfer(writeData: Buffer, readLength?: number): Promise<Buffer> {
    if (!this.spi) {
      throw new Error('Device not open');
    }

    if (!this._spiInitialized) {
      await this.spiInit();
    }

    // Use writeRead for full duplex transfer
    return this.spi.transfer(writeData);
  }

  async spiSendCommand(writeData: Buffer, readLength = 0): Promise<Buffer> {
    if (!this.spi) {
      throw new Error('Device not open');
    }

    if (!this._spiInitialized) {
      await this.spiInit();
    }

    return this.spi.sendCommand(writeData, readLength);
  }

  async spiBulkRead(address: number, length: number, readCmd = 0x03): Promise<Buffer> {
    if (!this.spi || !this.usb) {
      throw new Error('Device not open');
    }

    if (!this._spiInitialized) {
      await this.spiInit();
    }

    // Build read command: cmd + 24-bit address
    const cmd = Buffer.alloc(4);
    cmd[0] = readCmd;
    cmd[1] = (address >> 16) & 0xff;
    cmd[2] = (address >> 8) & 0xff;
    cmd[3] = address & 0xff;

    // For large reads, we need to chunk
    const maxChunk = this.usb.getMaxDataLen();
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

      const chunkData = await this.spi.sendCommand(chunkCmd, chunkLen);
      chunkData.copy(result, offset);
      offset += chunkLen;
    }

    return result;
  }

  // ==================== GPIO Operations ====================

  async gpioReadAll(): Promise<GPIOState[]> {
    if (!this.gpio) {
      throw new Error('Device not open');
    }
    return this.gpio.readAll();
  }

  async gpioRead(pin: number): Promise<GPIOState> {
    if (!this.gpio) {
      throw new Error('Device not open');
    }
    return this.gpio.read(pin);
  }

  async gpioWrite(pin: number, value: boolean): Promise<void> {
    if (!this.gpio) {
      throw new Error('Device not open');
    }
    return this.gpio.write(pin, value);
  }

  async gpioWriteMultiple(pins: { pin: number; value: boolean }[]): Promise<void> {
    if (!this.gpio) {
      throw new Error('Device not open');
    }
    return this.gpio.writeMultiple(pins);
  }

  async gpioSetDirection(pin: number, direction: 'input' | 'output'): Promise<void> {
    if (!this.gpio) {
      throw new Error('Device not open');
    }
    return this.gpio.setDirection(pin, direction);
  }

  async gpioConfigure(configs: GPIOConfig[]): Promise<void> {
    if (!this.gpio) {
      throw new Error('Device not open');
    }
    return this.gpio.configure(configs);
  }

  async gpioPulse(pin: number, durationMs = 100, activeHigh = true): Promise<void> {
    if (!this.gpio) {
      throw new Error('Device not open');
    }
    return this.gpio.pulse(pin, durationMs, activeHigh);
  }

  async gpioToggle(pin: number): Promise<boolean> {
    if (!this.gpio) {
      throw new Error('Device not open');
    }
    return this.gpio.toggle(pin);
  }
}
