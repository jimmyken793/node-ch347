/**
 * CH347 USB Constants and Protocol Definitions
 */

// USB Vendor and Product IDs
export const CH347_VID = 0x1a86;
export const CH347_PID_SPI_I2C_UART = 0x55db; // Mode 1: SPI + I2C + UART
export const CH347_PID_JTAG_I2C_UART = 0x55dd; // Mode 3: JTAG + I2C + UART

// USB Endpoints (Mode 1 - SPI/I2C/GPIO interface is on interface 2)
export const CH347_EP_OUT = 0x06;
export const CH347_EP_IN = 0x86;
export const CH347_IFACE_SPI_I2C_GPIO = 2;
export const CH347_IFACE_UART = 0; // UART is typically on interface 0

// USB Transfer Constants
// The USB descriptor says the max transfer size is 512 bytes, but the
// vendor driver only seems to transfer a maximum of 510 bytes at once,
// leaving 507 bytes for data as the command + length take up 3 bytes
export const CH347_PACKET_SIZE = 510;
export const CH347_MAX_DATA_LEN = 507; // CH347_PACKET_SIZE - 3
export const CH347_TIMEOUT_MS = 30000; // 30 seconds for flash operations

// GPIO Commands
export const CH347_CMD_GPIO = 0xcc;
export const CH347_GPIO_COUNT = 8;

// GPIO Pin Bit Masks (for gpio_obuf[3 + pin])
export const GPIO_PIN_ENABLE = 0xc0;    // Enable pin change
export const GPIO_PIN_DIR_OUT = 0x30;   // Set direction to output
export const GPIO_PIN_VALUE_HIGH = 0x08; // Set value high

// GPIO Response Bit Masks (for gpio_ibuf[3 + pin])
export const GPIO_PIN_IS_OUTPUT = 0x80; // Direction is output
export const GPIO_PIN_VALUE = 0x40;     // Current value

// I2C Commands
export const CH347_CMD_I2C_STREAM = 0xaa;
export const CH347_CMD_I2C_STM_END = 0x00;
export const CH347_CMD_I2C_STM_STA = 0x74; // Start condition
export const CH347_CMD_I2C_STM_STO = 0x75; // Stop condition
export const CH347_CMD_I2C_STM_OUT = 0x80; // Output data (| length)
export const CH347_CMD_I2C_STM_IN = 0xc0;  // Input data (| length)
export const CH347_CMD_I2C_STM_SET = 0x60; // Set speed (| speed)

// I2C Speed modes
export enum I2CSpeed {
  LOW = 0,      // 20kHz
  STANDARD = 1, // 100kHz
  FAST = 2,     // 400kHz
  HIGH = 3,     // 750kHz
}

// SPI Commands (from flashrom ch347_spi.c)
export const CH347_CMD_SPI_SET_CFG = 0xc0;
export const CH347_CMD_SPI_CS_CTRL = 0xc1;
export const CH347_CMD_SPI_OUT_IN = 0xc2;
export const CH347_CMD_SPI_IN = 0xc3;
export const CH347_CMD_SPI_OUT = 0xc4;
export const CH347_CMD_SPI_GET_CFG = 0xca;

// SPI Chip Select Control
export const CH347_CS_ASSERT = 0x00;
export const CH347_CS_DEASSERT = 0x40;
export const CH347_CS_CHANGE = 0x80;
export const CH347_CS_IGNORE = 0x00;

// SPI Clock Speeds (divisor values for CH347SPI_Init iClock parameter)
export enum SPISpeed {
  CLK_60M = 0,
  CLK_30M = 1,
  CLK_15M = 2,
  CLK_7_5M = 3,
  CLK_3_75M = 4,
  CLK_1_875M = 5,
  CLK_937_5K = 6,
  CLK_468_75K = 7,
}

/**
 * SPI Frequency values in Hz for use with CH347SPI_SetFrequency
 * The DLL will automatically select the nearest supported frequency.
 */
export const SPIFrequency = {
  // High speed
  F_60MHz: 60_000_000,
  F_48MHz: 48_000_000,
  F_36MHz: 36_000_000,
  F_30MHz: 30_000_000,
  F_28MHz: 28_000_000,
  F_24MHz: 24_000_000,
  F_18MHz: 18_000_000,
  F_15MHz: 15_000_000,
  F_14MHz: 14_000_000,
  F_12MHz: 12_000_000,
  F_9MHz: 9_000_000,
  // Medium speed
  F_7_5MHz: 7_500_000,
  F_7MHz: 7_000_000,
  F_6MHz: 6_000_000,
  F_4_5MHz: 4_500_000,
  F_3_75MHz: 3_750_000,
  F_3_5MHz: 3_500_000,
  F_3MHz: 3_000_000,
  F_2_25MHz: 2_250_000,
  F_1_875MHz: 1_875_000,
  F_1_75MHz: 1_750_000,
  F_1_5MHz: 1_500_000,
  F_1_125MHz: 1_125_000,
  // Low speed
  F_937_5KHz: 937_500,
  F_875KHz: 875_000,
  F_750KHz: 750_000,
  F_562_5KHz: 562_500,
  F_468_75KHz: 468_750,
  F_437_5KHz: 437_500,
  F_375KHz: 375_000,
  F_281_25KHz: 281_250,
  F_218_75KHz: 218_750,
} as const;

// SPI Modes
export enum SPIMode {
  MODE_0 = 0, // CPOL=0, CPHA=0
  MODE_1 = 1, // CPOL=0, CPHA=1
  MODE_2 = 2, // CPOL=1, CPHA=0
  MODE_3 = 3, // CPOL=1, CPHA=1
}

// SPI Flash Commands (common JEDEC commands)
export const FLASH_CMD_WRITE_ENABLE = 0x06;
export const FLASH_CMD_WRITE_DISABLE = 0x04;
export const FLASH_CMD_READ_STATUS = 0x05;
export const FLASH_CMD_WRITE_STATUS = 0x01;
export const FLASH_CMD_READ_DATA = 0x03;
export const FLASH_CMD_FAST_READ = 0x0b;
export const FLASH_CMD_READ_DATA_4BYTE = 0x13;
export const FLASH_CMD_PAGE_PROGRAM = 0x02;
export const FLASH_CMD_PAGE_PROGRAM_4BYTE = 0x12;
export const FLASH_CMD_SECTOR_ERASE = 0x20;    // 4KB
export const FLASH_CMD_SECTOR_ERASE_4BYTE = 0x21; // 4KB, 4-byte address
export const FLASH_CMD_BLOCK_ERASE_32K = 0x52; // 32KB
export const FLASH_CMD_BLOCK_ERASE_32K_4BYTE = 0x5c; // 32KB, 4-byte address
export const FLASH_CMD_BLOCK_ERASE_64K = 0xd8; // 64KB
export const FLASH_CMD_BLOCK_ERASE_64K_4BYTE = 0xdc; // 64KB, 4-byte address
export const FLASH_CMD_CHIP_ERASE = 0xc7;
export const FLASH_CMD_READ_ID = 0x9f;
export const FLASH_CMD_READ_JEDEC_ID = 0x9f;
export const FLASH_CMD_POWER_DOWN = 0xb9;
export const FLASH_CMD_RELEASE_POWER_DOWN = 0xab;
export const FLASH_CMD_READ_SFDP = 0x5a;         // Read SFDP (Serial Flash Discoverable Parameters)

// Flash Status Register Bits
export const FLASH_STATUS_WIP = 0x01;  // Write In Progress
export const FLASH_STATUS_WEL = 0x02;  // Write Enable Latch

// Flash Constants
export const FLASH_PAGE_SIZE = 256;
export const FLASH_SECTOR_SIZE = 4096;
export const FLASH_BLOCK_SIZE_32K = 32768;
export const FLASH_BLOCK_SIZE_64K = 65536;

// UART interface - uses CDC ACM protocol via serial port
// The CH347 UART appears as a virtual COM port
export const CH347_UART_DEFAULT_BAUD = 115200;

// Default SPI configuration
export const DEFAULT_SPI_CONFIG = {
  speed: SPISpeed.CLK_15M,
  mode: SPIMode.MODE_0,
  chipSelect: 0 as 0 | 1,
  bitOrder: 'MSB' as 'MSB' | 'LSB',
};

// Utility function for async delay
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
