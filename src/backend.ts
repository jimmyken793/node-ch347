/**
 * CH347 Backend Interface
 *
 * Defines the interface that all CH347 backends must implement.
 * This allows CH347Device to work with different backends (libusb, WCH DLL, etc.)
 */

import { SPIConfig, GPIOState, GPIOConfig, CH347DeviceInfo } from './types';

/**
 * Backend interface for CH347 device communication
 */
export interface CH347Backend {
  // ==================== Device Management ====================

  /**
   * Open connection to CH347 device
   * @param deviceIndex Index of device to open (default 0)
   */
  open(deviceIndex?: number): Promise<void>;

  /**
   * Close connection
   */
  close(): Promise<void>;

  /**
   * Check if device is connected
   */
  isConnected(): boolean;

  /**
   * Get the UART tty path for this CH347 device
   * Returns null if not available (e.g., WCH DLL backend)
   */
  getUARTPath(): string | null;

  // ==================== SPI Operations ====================

  /**
   * Initialize SPI interface with configuration
   */
  spiInit(config?: Partial<SPIConfig>): Promise<void>;

  /**
   * Get current SPI configuration
   */
  spiGetConfig(): SPIConfig;

  /**
   * Check if SPI is initialized
   */
  spiIsInitialized(): boolean;

  /**
   * SPI transfer (write and read simultaneously)
   */
  spiTransfer(writeData: Buffer, readLength?: number): Promise<Buffer>;

  /**
   * Send SPI command and read response
   * This is the main interface for flash operations
   */
  spiSendCommand(writeData: Buffer, readLength?: number): Promise<Buffer>;

  /**
   * Bulk read from SPI (for flash read operations)
   */
  spiBulkRead(address: number, length: number, readCmd?: number): Promise<Buffer>;

  // ==================== GPIO Operations ====================

  /**
   * Read all GPIO pin states
   */
  gpioReadAll(): Promise<GPIOState[]>;

  /**
   * Read single GPIO pin state
   */
  gpioRead(pin: number): Promise<GPIOState>;

  /**
   * Set GPIO output value
   */
  gpioWrite(pin: number, value: boolean): Promise<void>;

  /**
   * Set multiple GPIO pins at once
   */
  gpioWriteMultiple(pins: { pin: number; value: boolean }[]): Promise<void>;

  /**
   * Configure GPIO pin direction
   */
  gpioSetDirection(pin: number, direction: 'input' | 'output'): Promise<void>;

  /**
   * Configure multiple GPIO pins
   */
  gpioConfigure(configs: GPIOConfig[]): Promise<void>;

  /**
   * Pulse a GPIO pin
   */
  gpioPulse(pin: number, durationMs?: number, activeHigh?: boolean): Promise<void>;

  /**
   * Toggle GPIO pin
   */
  gpioToggle(pin: number): Promise<boolean>;
}

/**
 * Static methods that backends should provide
 */
export interface CH347BackendStatic {
  /**
   * List all connected CH347 devices
   */
  listDevices(): Promise<CH347DeviceInfo[]>;

  /**
   * Check if the backend is available
   */
  isAvailable(): boolean;
}
