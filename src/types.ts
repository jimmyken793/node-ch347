/**
 * CH347 Type Definitions
 */

import { SPISpeed, SPIMode, I2CSpeed } from './constants';

/**
 * Windows USB backend options
 * - 'usbdk': UsbDk backend (recommended) - coexists with vendor driver
 * - 'winusb': Native WinUSB - requires Zadig driver replacement
 * - 'wch': WCH's CH347DLL.dll - requires DLL in PATH or app directory
 * - 'auto': Try UsbDk first, then WinUSB
 */
export type WindowsUsbBackend = 'usbdk' | 'winusb' | 'wch' | 'auto';

export interface CH347DeviceInfo {
  vendorId: number;
  productId: number;
  serialNumber?: string;
  manufacturer?: string;
  product?: string;
  busNumber: number;
  deviceAddress: number;
}

export interface GPIOConfig {
  pin: number;
  direction: 'input' | 'output';
  value?: boolean;
}

export interface GPIOState {
  pin: number;
  direction: 'input' | 'output';
  value: boolean;
}

export interface SPIConfig {
  speed: SPISpeed;
  mode: SPIMode;
  chipSelect: 0 | 1;
  bitOrder: 'MSB' | 'LSB';
}

export interface EraseType {
  command: number;    // Erase command (e.g., 0x20, 0x52, 0xd8)
  size: number;       // Erase size in bytes
  timeoutMs: number;  // Typical timeout for this erase type
}

export interface FlashInfo {
  manufacturerId: number;
  memoryType: number;
  capacity: number;
  jedecId: number;
  size: number; // Total size in bytes
  name?: string;
  // SFDP-discovered parameters
  sfdpSupported?: boolean;
  pageSize?: number;          // Page size (default 256)
  eraseTypes?: EraseType[];   // Available erase commands, sorted by size descending
}

export interface FlashProgress {
  operation: 'read' | 'write' | 'erase' | 'verify';
  current: number;
  total: number;
  percentage: number;
}

export type FlashProgressCallback = (progress: FlashProgress) => void;

export interface I2CConfig {
  speed: I2CSpeed;
}

export interface UARTConfig {
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'odd' | 'even';
  flowControl: 'none' | 'hardware';
}

export interface CH347Options {
  gpio?: Partial<GPIOConfig>[];
  spi?: Partial<SPIConfig>;
  i2c?: Partial<I2CConfig>;
  uart?: Partial<UARTConfig>;
}

// Known flash manufacturers
export const FlashManufacturers: Record<number, string> = {
  0xef: 'Winbond',
  0xc8: 'GigaDevice',
  0x20: 'Micron/Numonyx/ST',
  0x1f: 'Atmel/Adesto',
  0xbf: 'SST/Microchip',
  0xc2: 'Macronix',
  0x9d: 'ISSI',
  0x01: 'Spansion/Cypress',
  0x1c: 'EON',
  0xa1: 'Fudan',
  0x68: 'Boya',
  0x85: 'Puya',
  0x5e: 'Zbit',
};

// Common flash chips database
export const FlashDatabase: Record<number, { name: string; size: number }> = {
  // Winbond
  0xef4014: { name: 'W25Q80', size: 1024 * 1024 },
  0xef4015: { name: 'W25Q16', size: 2 * 1024 * 1024 },
  0xef4016: { name: 'W25Q32', size: 4 * 1024 * 1024 },
  0xef4017: { name: 'W25Q64', size: 8 * 1024 * 1024 },
  0xef4018: { name: 'W25Q128', size: 16 * 1024 * 1024 },
  0xef4019: { name: 'W25Q256', size: 32 * 1024 * 1024 },
  // GigaDevice
  0xc84014: { name: 'GD25Q80', size: 1024 * 1024 },
  0xc84015: { name: 'GD25Q16', size: 2 * 1024 * 1024 },
  0xc84016: { name: 'GD25Q32', size: 4 * 1024 * 1024 },
  0xc84017: { name: 'GD25Q64', size: 8 * 1024 * 1024 },
  0xc84018: { name: 'GD25Q128', size: 16 * 1024 * 1024 },
  // Macronix
  0xc22014: { name: 'MX25L8005', size: 1024 * 1024 },
  0xc22015: { name: 'MX25L1605', size: 2 * 1024 * 1024 },
  0xc22016: { name: 'MX25L3205', size: 4 * 1024 * 1024 },
  0xc22017: { name: 'MX25L6405', size: 8 * 1024 * 1024 },
  0xc22018: { name: 'MX25L12805', size: 16 * 1024 * 1024 },
};
