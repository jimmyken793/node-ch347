/**
 * CH347 Library
 *
 * A Node.js library for interfacing with CH347 USB devices.
 * Supports GPIO and SPI flash programming.
 * UART path discovery is provided; use external serial libraries for UART communication.
 *
 * Cross-platform: Linux and macOS
 */

// Core modules
export { CH347USB } from './usb';
export { CH347GPIO } from './gpio';
export { CH347SPI } from './spi';
export { CH347Flash } from './flash';

// Device configuration (serial number, etc.)
export {
  listDevicesWithSerial,
  CH347DeviceWithSerial,
} from './config';

// Types
export * from './types';

// Constants
export * from './constants';

// Convenience class that combines all functionality
import { CH347USB } from './usb';
import { CH347GPIO } from './gpio';
import { CH347SPI } from './spi';
import { CH347Flash } from './flash';
import {
  listDevicesWithSerial,
  CH347DeviceWithSerial,
} from './config';
import {
  CH347DeviceInfo,
  SPIConfig,
  FlashInfo,
  GPIOState,
} from './types';
import { SPISpeed, SPIMode } from './constants';

export interface CH347DeviceOptions {
  spi?: Partial<SPIConfig>;
}

/**
 * Main CH347 device class
 * Provides unified access to GPIO, SPI, and Flash functionality
 */
export class CH347Device {
  private usb: CH347USB;
  private _gpio: CH347GPIO | null = null;
  private _spi: CH347SPI | null = null;
  private _flash: CH347Flash | null = null;
  private options: CH347DeviceOptions;

  constructor(options: CH347DeviceOptions = {}) {
    this.usb = new CH347USB();
    this.options = options;
  }

  /**
   * List all connected CH347 devices
   */
  static listDevices(): CH347DeviceInfo[] {
    return CH347USB.listDevices();
  }

  /**
   * List all connected CH347 devices with their serial numbers
   */
  static async listDevicesWithSerial(): Promise<CH347DeviceWithSerial[]> {
    return listDevicesWithSerial();
  }

  /**
   * Open connection to CH347 device
   * @param deviceIndex Index of device to open (default 0)
   */
  async open(deviceIndex = 0): Promise<void> {
    await this.usb.open(deviceIndex);

    // Initialize GPIO
    this._gpio = new CH347GPIO(this.usb);

    // Initialize SPI with optional config
    this._spi = new CH347SPI(this.usb, this.options.spi);

    // Initialize Flash (wraps SPI)
    this._flash = new CH347Flash(this._spi);
  }

  /**
   * Close connection
   */
  close(): void {
    this.usb.close();
    this._gpio = null;
    this._spi = null;
    this._flash = null;
  }

  /**
   * Check if device is connected
   */
  isConnected(): boolean {
    return this.usb.isConnected();
  }

  /**
   * Get the UART tty path for this CH347 device
   * Returns the serial port path (e.g., '/dev/ttyACM0' on Linux, '/dev/tty.usbmodem*' on macOS)
   */
  getUARTPath(): string | null {
    return this.usb.getUARTPath();
  }

  /**
   * Get GPIO controller
   */
  get gpio(): CH347GPIO {
    if (!this._gpio) {
      throw new Error('Device not open');
    }
    return this._gpio;
  }

  /**
   * Get SPI controller
   */
  get spi(): CH347SPI {
    if (!this._spi) {
      throw new Error('Device not open');
    }
    return this._spi;
  }

  /**
   * Get Flash programmer
   */
  get flash(): CH347Flash {
    if (!this._flash) {
      throw new Error('Device not open');
    }
    return this._flash;
  }

  // ==================== GPIO Convenience Methods ====================

  /**
   * Read all GPIO pin states
   */
  async gpioReadAll(): Promise<GPIOState[]> {
    return this.gpio.readAll();
  }

  /**
   * Set GPIO pin output value
   */
  async gpioWrite(pin: number, value: boolean): Promise<void> {
    return this.gpio.write(pin, value);
  }

  /**
   * Read GPIO pin state
   */
  async gpioRead(pin: number): Promise<GPIOState> {
    return this.gpio.read(pin);
  }

  /**
   * Pulse GPIO pin (for button press simulation)
   */
  async gpioPulse(
    pin: number,
    durationMs = 100,
    activeHigh = true
  ): Promise<void> {
    return this.gpio.pulse(pin, durationMs, activeHigh);
  }

  // ==================== SPI Flash Convenience Methods ====================

  /**
   * Initialize SPI interface
   */
  async spiInit(config?: Partial<SPIConfig>): Promise<void> {
    return this.spi.init(config);
  }

  /**
   * Read flash JEDEC ID
   */
  async flashReadId(): Promise<FlashInfo> {
    return this.flash.readJedecId();
  }

  /**
   * Read data from flash
   */
  async flashRead(
    address: number,
    length: number,
    onProgress?: (progress: { percentage: number }) => void
  ): Promise<Buffer> {
    return this.flash.read(address, length, onProgress);
  }

  /**
   * Write data to flash
   */
  async flashWrite(
    address: number,
    data: Buffer,
    onProgress?: (progress: { percentage: number }) => void
  ): Promise<void> {
    return this.flash.write(address, data, onProgress);
  }

  /**
   * Erase flash sector (4KB)
   */
  async flashEraseSector(address: number): Promise<void> {
    return this.flash.eraseSector(address);
  }

  /**
   * Erase entire flash chip
   */
  async flashEraseChip(
    onProgress?: (progress: { percentage: number }) => void
  ): Promise<void> {
    return this.flash.eraseChip(onProgress);
  }

  /**
   * Program flash (erase + write + verify)
   */
  async flashProgram(
    address: number,
    data: Buffer,
    options?: {
      erase?: boolean;
      verify?: boolean;
      onProgress?: (progress: { percentage: number }) => void;
    }
  ): Promise<boolean> {
    return this.flash.program(address, data, options);
  }

  /**
   * Program flash from a binary file
   * If address is not specified, requires file size to match flash size (call flashReadId first)
   */
  async flashProgramFile(
    filePath: string,
    address?: number,
    options?: {
      erase?: boolean;
      verify?: boolean;
      onProgress?: (progress: { percentage: number }) => void;
    }
  ): Promise<boolean> {
    return this.flash.programFile(filePath, address, options);
  }

  /**
   * Read flash contents to a binary file
   */
  async flashReadToFile(
    filePath: string,
    address = 0,
    length?: number,
    onProgress?: (progress: { percentage: number }) => void
  ): Promise<void> {
    return this.flash.readToFile(filePath, address, length, onProgress);
  }
}

// Default export
export default CH347Device;
