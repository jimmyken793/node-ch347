/**
 * CH347 Library
 *
 * A Node.js library for interfacing with CH347 USB devices.
 * Supports GPIO and SPI flash programming.
 * UART path discovery is provided; use external serial libraries for UART communication.
 *
 * Cross-platform: Linux, macOS, and Windows
 * Windows requires UsbDk or WinUSB driver (via Zadig), or WCH DLL
 */

// Backend interface and implementations
export { CH347Backend } from './backend';
export { LibUSBBackend } from './backend-libusb';
export { WCHBackend } from './backend-wch';

// Core modules (for advanced usage)
export { CH347USB, setWindowsBackend, getWindowsBackend } from './usb';
export { CH347GPIO } from './gpio';
export { CH347SPI } from './spi';
export { CH347Flash } from './flash';

// WCH DLL (for direct access)
export { CH347WCH, isWCHDLLAvailable, loadWCHDLL, getWCHDLLError } from './wch-dll';

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
import { CH347Backend } from './backend';
import { LibUSBBackend } from './backend-libusb';
import { WCHBackend } from './backend-wch';
import { CH347Flash } from './flash';
import { isWCHDLLAvailable } from './wch-dll';
import { getWindowsBackend } from './usb';
import {
  listDevicesWithSerial,
  CH347DeviceWithSerial,
} from './config';
import {
  CH347DeviceInfo,
  SPIConfig,
  SPIInterface,
  FlashInfo,
  FlashProgress,
  GPIOState,
  WindowsUsbBackend,
} from './types';

export interface CH347DeviceOptions {
  spi?: Partial<SPIConfig>;
  /**
   * Force a specific backend.
   * - 'auto': Auto-select based on platform (default)
   * - 'usbdk': Use UsbDk backend (Windows)
   * - 'winusb': Use WinUSB backend (Windows)
   * - 'wch': Use WCH DLL backend (Windows only)
   */
  backend?: WindowsUsbBackend;
}

/**
 * Get the currently active backend class based on platform and settings.
 * @param backendOverride Optional backend override (from device options)
 */
function getActiveBackendClass(backendOverride?: WindowsUsbBackend): typeof LibUSBBackend | typeof WCHBackend {
  // Only consider WCH backend on Windows
  if (process.platform === 'win32') {
    const backendSetting = backendOverride ?? getWindowsBackend();
    if (backendSetting === 'wch' && isWCHDLLAvailable()) {
      return WCHBackend;
    }
  }
  return LibUSBBackend;
}

/**
 * Main CH347 device class
 * Provides unified access to GPIO, SPI, and Flash functionality.
 * Automatically selects the appropriate backend based on platform and settings.
 */
export class CH347Device {
  private backend: CH347Backend | null = null;
  private _flash: CH347Flash | null = null;
  private options: CH347DeviceOptions;
  private _usingWCHBackend = false;

  constructor(options: CH347DeviceOptions = {}) {
    this.options = options;
  }

  /**
   * Get the backend class for this device instance
   */
  private getBackendClass(): typeof LibUSBBackend | typeof WCHBackend {
    return getActiveBackendClass(this.options.backend);
  }

  /**
   * List all connected CH347 devices
   * Respects the current backend selection on Windows.
   */
  static listDevices(): CH347DeviceInfo[] {
    return getActiveBackendClass().listDevices();
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
    const BackendClass = this.getBackendClass();
    this._usingWCHBackend = BackendClass === WCHBackend;

    // Both backends now accept SPI config in constructor and auto-initialize
    if (this._usingWCHBackend) {
      this.backend = new WCHBackend(this.options.spi);
    } else {
      this.backend = new LibUSBBackend(this.options.spi);
    }

    await this.backend.open(deviceIndex);

    // Create Flash wrapper using a SPI adapter
    this._flash = new CH347Flash(this.createSPIAdapter());
  }

  /**
   * Create an SPI adapter for the Flash class
   */
  private createSPIAdapter(): SPIInterface {
    const backend = this.backend!;

    // Create an object that implements SPIInterface
    // This allows CH347Flash to work with any backend
    return {
      init: async (config?: Partial<SPIConfig>) => backend.spiInit(config),
      sendCommand: async (writeData: Buffer, readLength = 0) =>
        backend.spiSendCommand(writeData, readLength),
      command: async (writeData: Buffer, readLength = 0) =>
        backend.spiSendCommand(writeData, readLength),
      transfer: async (data: Buffer) => backend.spiTransfer(data),
      write: async (data: Buffer) => { await backend.spiSendCommand(data, 0); },
      read: async (length: number) => backend.spiSendCommand(Buffer.alloc(0), length),
      writeRead: async (data: Buffer) => backend.spiTransfer(data),
      setChipSelect: async (_active: boolean) => { /* handled internally */ },
      csControl: async (_cs1: number, _cs2?: number) => { /* handled internally */ },
      getConfig: () => backend.spiGetConfig(),
      isReady: () => backend.spiIsInitialized(),
    };
  }

  /**
   * Close connection
   */
  close(): void {
    if (this.backend) {
      this.backend.close();
      this.backend = null;
    }
    this._flash = null;
  }

  /**
   * Check if device is connected
   */
  isConnected(): boolean {
    return this.backend?.isConnected() ?? false;
  }

  /**
   * Get the UART tty path for this CH347 device
   * Returns the serial port path (e.g., '/dev/ttyACM0' on Linux, '/dev/tty.usbmodem*' on macOS)
   * Note: Not available when using WCH DLL backend on Windows
   */
  getUARTPath(): string | null {
    return this.backend?.getUARTPath() ?? null;
  }

  /**
   * Get the underlying backend (for advanced usage)
   */
  getBackend(): CH347Backend {
    if (!this.backend) {
      throw new Error('Device not open');
    }
    return this.backend;
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

  /**
   * Check if using WCH DLL backend
   */
  isUsingWCHBackend(): boolean {
    return this._usingWCHBackend;
  }

  // ==================== GPIO Convenience Methods ====================

  /**
   * Read all GPIO pin states
   */
  async gpioReadAll(): Promise<GPIOState[]> {
    if (!this.backend) throw new Error('Device not open');
    return this.backend.gpioReadAll();
  }

  /**
   * Set GPIO pin output value
   */
  async gpioWrite(pin: number, value: boolean): Promise<void> {
    if (!this.backend) throw new Error('Device not open');
    return this.backend.gpioWrite(pin, value);
  }

  /**
   * Read GPIO pin state
   */
  async gpioRead(pin: number): Promise<GPIOState> {
    if (!this.backend) throw new Error('Device not open');
    return this.backend.gpioRead(pin);
  }

  /**
   * Pulse GPIO pin (for button press simulation)
   */
  async gpioPulse(pin: number, durationMs = 100, activeHigh = true): Promise<void> {
    if (!this.backend) throw new Error('Device not open');
    return this.backend.gpioPulse(pin, durationMs, activeHigh);
  }

  /**
   * Toggle GPIO pin
   */
  async gpioToggle(pin: number): Promise<boolean> {
    if (!this.backend) throw new Error('Device not open');
    return this.backend.gpioToggle(pin);
  }

  // ==================== SPI Convenience Methods ====================

  /**
   * Initialize SPI interface
   */
  async spiInit(config?: Partial<SPIConfig>): Promise<void> {
    if (!this.backend) throw new Error('Device not open');
    return this.backend.spiInit(config);
  }

  /**
   * SPI transfer (write and read)
   */
  async spiTransfer(writeData: Buffer, readLength?: number): Promise<Buffer> {
    if (!this.backend) throw new Error('Device not open');
    return this.backend.spiTransfer(writeData, readLength);
  }

  /**
   * Send SPI command and read response
   */
  async spiSendCommand(writeData: Buffer, readLength = 0): Promise<Buffer> {
    if (!this.backend) throw new Error('Device not open');
    return this.backend.spiSendCommand(writeData, readLength);
  }

  // ==================== SPI Flash Convenience Methods ====================

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
   */
  async flashProgramFile(
    filePath: string,
    address?: number,
    options?: {
      erase?: boolean;
      verify?: boolean;
      onProgress?: (progress: FlashProgress) => void;
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
