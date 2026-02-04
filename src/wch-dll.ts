/**
 * WCH CH347DLL.dll Wrapper
 *
 * This module provides an interface to WCH's proprietary CH347DLL.dll.
 * The DLL is NOT included in this package due to licensing concerns.
 *
 * Users must obtain CH347DLL.dll from WCH's official download:
 * https://www.wch.cn/downloads/CH341PAR_ZIP.html
 *
 * Place the DLL in one of these locations:
 * - Your application's directory
 * - System PATH
 * - C:\Windows\System32
 *
 * Requires: npm install koffi
 */

import { SPIConfig, GPIOState } from './types';
import { SPISpeed, SPIMode } from './constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let koffi: any = null;

// Unified interface for DLL functions
interface WCHFunctions {
  CH347OpenDevice: (deviceIndex: number) => number;
  CH347CloseDevice: (deviceIndex: number) => void;
  CH347SPI_Init: (deviceIndex: number, spiCfg: Buffer | Uint8Array) => number;
  CH347SPI_SetChipSelect: (
    deviceIndex: number,
    enable: number,
    select: number,
    csIdle: number,
    csActive: number
  ) => number;
  CH347SPI_Write: (
    deviceIndex: number,
    chipSelect: number,
    length: number,
    writeStep: number,
    writeBuffer: Buffer | Uint8Array
  ) => number;
  CH347SPI_Read: (
    deviceIndex: number,
    chipSelect: number,
    commandLength: number,
    readLength: Uint32Array | number[],
    ioBuffer: Buffer | Uint8Array
  ) => number;
  CH347SPI_WriteRead: (
    deviceIndex: number,
    chipSelect: number,
    length: number,
    writeBuffer: Buffer | Uint8Array
  ) => number;
  CH347GPIO_Set: (
    deviceIndex: number,
    enable: number,
    dirOut: number,
    dataOut: number
  ) => number;
  CH347GPIO_Get: (
    deviceIndex: number,
    dirBuffer: Buffer | Uint8Array,
    dataBuffer: Buffer | Uint8Array
  ) => number;
}

let wchLib: WCHFunctions | null = null;
let dllLoaded = false;
let dllLoadError: Error | null = null;

/**
 * Attempt to load the WCH DLL
 * @returns true if loaded successfully, false otherwise
 */
export function loadWCHDLL(): boolean {
  if (dllLoaded) return true;
  if (dllLoadError) return false;

  try {
    koffi = require('koffi');
  } catch {
    dllLoadError = new Error(
      'koffi is required for WCH DLL backend. Install with: npm install koffi'
    );
    return false;
  }

  const dllNames = ['CH347DLL', 'CH347DLLA64', './CH347DLL', './CH347DLLA64'];

  for (const dllName of dllNames) {
    try {
      const lib = koffi.load(dllName + '.dll');

      wchLib = {
        CH347OpenDevice: lib.func('int CH347OpenDevice(int)'),
        CH347CloseDevice: lib.func('void CH347CloseDevice(int)'),
        CH347SPI_Init: lib.func('int CH347SPI_Init(int, void*)'),
        CH347SPI_SetChipSelect: lib.func('int CH347SPI_SetChipSelect(int, int, int, int, int)'),
        CH347SPI_Write: lib.func('int CH347SPI_Write(int, int, int, int, void*)'),
        CH347SPI_Read: lib.func('int CH347SPI_Read(int, int, uint32, uint32*, void*)'),
        CH347SPI_WriteRead: lib.func('int CH347SPI_WriteRead(int, int, int, void*)'),
        CH347GPIO_Set: lib.func('int CH347GPIO_Set(int, int, int, int)'),
        CH347GPIO_Get: lib.func('int CH347GPIO_Get(int, void*, void*)'),
      };

      dllLoaded = true;
      return true;
    } catch {
      // Try next DLL name
    }
  }

  dllLoadError = new Error(
    'CH347DLL.dll not found. Download from: https://www.wch.cn/downloads/CH341PAR_ZIP.html'
  );

  return false;
}

/**
 * Get the DLL load error if any
 */
export function getWCHDLLError(): Error | null {
  return dllLoadError;
}

/**
 * Check if WCH DLL is available
 */
export function isWCHDLLAvailable(): boolean {
  if (dllLoaded) return true;
  return loadWCHDLL();
}

/**
 * WCH DLL-based CH347 USB implementation
 */
export class CH347WCH {
  private deviceIndex: number = -1;
  private isOpen = false;

  /**
   * List available CH347 devices
   * Note: WCH DLL doesn't have a proper enumeration function,
   * so we try to open devices 0-15 to check availability
   */
  static listDevices(): number[] {
    if (!loadWCHDLL()) {
      throw dllLoadError;
    }

    const devices: number[] = [];
    for (let i = 0; i < 16; i++) {
      const handle = wchLib!.CH347OpenDevice(i);
      if (handle !== -1) {
        devices.push(i);
        wchLib!.CH347CloseDevice(i);
      }
    }
    return devices;
  }

  /**
   * Open connection to CH347 device
   */
  open(deviceIndex = 0): void {
    if (!loadWCHDLL()) {
      throw dllLoadError;
    }

    const handle = wchLib!.CH347OpenDevice(deviceIndex);
    if (handle === -1) {
      throw new Error(`Failed to open CH347 device ${deviceIndex}`);
    }

    this.deviceIndex = deviceIndex;
    this.isOpen = true;
  }

  /**
   * Close connection
   */
  close(): void {
    if (this.isOpen && this.deviceIndex >= 0) {
      wchLib!.CH347CloseDevice(this.deviceIndex);
      this.isOpen = false;
      this.deviceIndex = -1;
    }
  }

  /**
   * Check if device is open
   */
  isConnected(): boolean {
    return this.isOpen;
  }

  /**
   * Initialize SPI interface
   */
  spiInit(config?: Partial<SPIConfig>): void {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    // SPI config structure for WCH DLL (mSpiCfgS) - packed with #pragma pack(1)
    // struct {
    //   UCHAR iMode;                  // offset 0: SPI mode (0-3)
    //   UCHAR iClock;                 // offset 1: Clock divisor
    //   UCHAR iByteOrder;             // offset 2: 0=LSB, 1=MSB
    //   USHORT iSpiWriteReadInterval; // offset 3: CS toggle interval
    //   UCHAR iSpiOutDefaultData;     // offset 5: Default MOSI data
    //   ULONG iChipSelect;            // offset 6: CS configuration
    //   UCHAR CS1Polarity;            // offset 10: CS1 polarity
    //   UCHAR CS2Polarity;            // offset 11: CS2 polarity
    //   USHORT iIsAutoDeativeCS;      // offset 12: Auto-deactivate CS
    //   USHORT iActiveDelay;          // offset 14: CS active delay
    //   ULONG iDelayDeactive;         // offset 16: CS deactive delay
    // } Total: 20 bytes
    const cfgBuffer = Buffer.alloc(20);
    let offset = 0;

    // iMode - SPI mode (0-3)
    cfgBuffer.writeUInt8(config?.mode ?? SPIMode.MODE_0, offset++);

    // iClock - Clock speed
    cfgBuffer.writeUInt8(config?.speed ?? SPISpeed.CLK_15M, offset++);

    // iByteOrder - 0=LSB (低位在前), 1=MSB (高位在前) - SPI flash typically uses MSB
    cfgBuffer.writeUInt8(config?.bitOrder === 'LSB' ? 0 : 1, offset++);

    // iSpiWriteReadInterval
    cfgBuffer.writeUInt16LE(0, offset);
    offset += 2;

    // iSpiOutDefaultData
    cfgBuffer.writeUInt8(0xff, offset++);

    // iChipSelect - use CS0 or CS1 (bit 7=1 means enable CS control)
    cfgBuffer.writeUInt32LE(config?.chipSelect === 1 ? 0x81 : 0x80, offset);
    offset += 4;

    // CS1Polarity, CS2Polarity (0=active low)
    cfgBuffer.writeUInt8(0, offset++);
    cfgBuffer.writeUInt8(0, offset++);

    // iIsAutoDeativeCS
    cfgBuffer.writeUInt16LE(1, offset);
    offset += 2;

    // iActiveDelay
    cfgBuffer.writeUInt16LE(0, offset);
    offset += 2;

    // iDelayDeactive
    cfgBuffer.writeUInt32LE(0, offset);

    const result = wchLib!.CH347SPI_Init(this.deviceIndex, cfgBuffer);
    if (result === 0) {
      throw new Error('Failed to initialize SPI');
    }
  }

  /**
   * SPI write and read
   */
  spiTransfer(writeData: Buffer): Buffer {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    const debug = process.env.DEBUG_WCH === '1';
    const ioBuffer = Buffer.alloc(writeData.length);
    writeData.copy(ioBuffer);

    if (debug) {
      console.log(`[WCH] spiTransfer: deviceIndex=${this.deviceIndex}, len=${writeData.length}, data=${writeData.subarray(0, Math.min(8, writeData.length)).toString('hex')}...`);
    }

    const result = wchLib!.CH347SPI_WriteRead(
      this.deviceIndex,
      0x80, // CS0 active
      writeData.length,
      ioBuffer
    );

    if (debug) {
      console.log(`[WCH] spiTransfer result: ${result}, response=${ioBuffer.subarray(0, Math.min(8, ioBuffer.length)).toString('hex')}...`);
    }

    if (result === 0) {
      throw new Error(`SPI transfer failed (WriteRead returned 0, len=${writeData.length}, cmd=0x${writeData[0]?.toString(16)})`);
    }

    return ioBuffer;
  }

  /**
   * SPI write only
   * Reference: WCH SPI_Flash.cpp
   *
   * Used for all write-only commands:
   * - Short commands: WREN (0x06), WRDI (0x04), erase commands
   * - Page program: 0x02 + addr + data (up to 260 bytes)
   *
   * From WCH SPI_Flash.cpp W25XXX_WR_Page:
   *   UCHAR buf[8*1024] = {0};
   *   buf[0] = W25X_PAGE_PROG;
   *   buf[1..3] = address;
   *   memcpy(&buf[4], pBuf, Len);
   *   return CH347SPI_Write(iIndex, 0x80, 4 + Len, 260, buf);
   *
   * From WCH SPI_Flash.cpp FlashWREN (write enable):
   *   buf[0] = CMD_WREN;
   *   return CH347SPI_WriteRead(iIndex, 0x80, 1, buf);
   *   // Note: Reference uses WriteRead for 1-byte WREN, but Write should also work
   */
  spiWrite(data: Buffer): void {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    const debug = process.env.DEBUG_WCH === '1';

    // writeStep hint for chunking large transfers
    // For page program: 260 = page size (256) + cmd/addr (4)
    // For short commands: use data length as step
    const SPI_FLASH_PAGE_STEP = 260;
    const writeStep = data.length > 4 ? SPI_FLASH_PAGE_STEP : data.length;

    // Reference uses 8KB buffer, but for short commands we can use smaller buffer
    const bufferSize = Math.max(data.length, SPI_FLASH_PAGE_STEP);
    const buffer = Buffer.alloc(bufferSize);
    data.copy(buffer);

    if (debug) {
      console.log(`[WCH] spiWrite: deviceIndex=${this.deviceIndex}, len=${data.length}, writeStep=${writeStep}, data=${data.subarray(0, Math.min(8, data.length)).toString('hex')}...`);
    }

    const result = wchLib!.CH347SPI_Write(
      this.deviceIndex,
      0x80, // CS0 active (bit 7 set)
      data.length, // Actual data length to write
      writeStep,
      buffer
    );

    if (debug) {
      console.log(`[WCH] spiWrite result: ${result}`);
    }

    if (result === 0) {
      throw new Error(`SPI write failed (Write returned 0, len=${data.length}, cmd=0x${data[0]?.toString(16)})`);
    }
  }

  /**
   * SPI read only (not used directly, see spiReadWithCommand)
   */
  spiRead(length: number): Buffer {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    const readBuffer = Buffer.alloc(length);
    const lengthPtr = new Uint32Array([length]);

    const result = wchLib!.CH347SPI_Read(
      this.deviceIndex,
      0x80, // CS0 active
      0, // No command bytes
      lengthPtr,
      readBuffer
    );

    if (result === 0) {
      throw new Error('SPI read failed');
    }

    return readBuffer;
  }

  /**
   * SPI read with command (for flash read operations)
   * This matches the official WCH implementation pattern from SPI_Flash.cpp
   *
   * Reference from WCH code:
   *   ULONG iLen = len;
   *   if (!CH347SPI_Read(DevIndex, 0x80, 4, &iLen, DBuf))
   *
   * @param command Command buffer (e.g., [0x03, addr_high, addr_mid, addr_low])
   * @param readLength Number of bytes to read after the command
   * @returns Data read from device
   */
  spiReadWithCommand(command: Buffer, readLength: number): Buffer {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    const debug = process.env.DEBUG_WCH === '1';

    // Buffer must contain command + space for data
    // Official WCH uses: UCHAR DBuf[8192]={0};
    // The command is copied to the buffer, then the buffer receives data
    const ioBuffer = Buffer.alloc(Math.max(8192, command.length + readLength));
    command.copy(ioBuffer);

    // Read length passed by reference using Uint32Array
    // This creates a proper pointer for the _Inout_ parameter
    const readLengthPtr = new Uint32Array([readLength]);

    if (debug) {
      console.log(`[WCH] spiReadWithCommand: cmd=${command.toString('hex')}, cmdLen=${command.length}, readLen=${readLength}`);
    }

    // Call CH347SPI_Read:
    // - iIndex: device index
    // - iChipSelect: 0x80 (CS0 active, bit 7=1)
    // - oLength: command length (number of bytes to send)
    // - iLength: pointer to read length (input: bytes to read, output: bytes actually read)
    // - ioBuffer: contains command, receives data
    const result = wchLib!.CH347SPI_Read(
      this.deviceIndex,
      0x80, // CS0 active
      command.length, // Command length (e.g., 4 for read command + 3-byte address)
      readLengthPtr, // Pointer to read length (passed by reference)
      ioBuffer
    );

    if (debug) {
      console.log(`[WCH] spiReadWithCommand result: ${result}, actualReadLen=${readLengthPtr[0]}`);
    }

    if (result === 0) {
      throw new Error(`SPI read with command failed (cmd=0x${command[0]?.toString(16)})`);
    }

    // Verify read length
    const actualReadLen = readLengthPtr[0];
    if (actualReadLen !== readLength) {
      console.warn(`Warning: Requested ${readLength} bytes, but read ${actualReadLen} bytes`);
    }

    // According to WCH code: memcpy(pbuf, DBuf, len);
    // The ioBuffer contains the data starting from the beginning
    return ioBuffer.subarray(0, actualReadLen);
  }

  /**
   * Control chip select
   */
  setChipSelect(active: boolean, csIndex: 0 | 1 = 0): void {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    const result = wchLib!.CH347SPI_SetChipSelect(
      this.deviceIndex,
      1, // Enable
      csIndex,
      active ? 0 : 1, // Idle state
      active ? 1 : 0 // Active state
    );

    if (result === 0) {
      throw new Error('Failed to set chip select');
    }
  }

  /**
   * Set GPIO pins
   */
  gpioSet(enable: number, direction: number, value: number): void {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    const result = wchLib!.CH347GPIO_Set(
      this.deviceIndex,
      enable,
      direction,
      value
    );

    if (result === 0) {
      throw new Error('Failed to set GPIO');
    }
  }

  /**
   * Get GPIO state
   */
  gpioGet(): { direction: number; value: number } {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    const dirBuffer = Buffer.alloc(1);
    const dataBuffer = Buffer.alloc(1);

    const result = wchLib!.CH347GPIO_Get(
      this.deviceIndex,
      dirBuffer,
      dataBuffer
    );

    if (result === 0) {
      throw new Error('Failed to get GPIO state');
    }

    return {
      direction: dirBuffer.readUInt8(0),
      value: dataBuffer.readUInt8(0),
    };
  }

  /**
   * Read all GPIO states (compatible with CH347GPIO interface)
   */
  gpioReadAll(): GPIOState[] {
    const { direction, value } = this.gpioGet();
    const states: GPIOState[] = [];

    for (let pin = 0; pin < 8; pin++) {
      states.push({
        pin,
        direction: (direction & (1 << pin)) ? 'output' : 'input',
        value: !!(value & (1 << pin)),
      });
    }

    return states;
  }

  /**
   * Write GPIO pin
   */
  gpioWrite(pin: number, pinValue: boolean): void {
    if (pin < 0 || pin > 7) {
      throw new Error('Pin must be 0-7');
    }

    const { direction, value } = this.gpioGet();
    const enable = 1 << pin;
    const newDir = direction | (1 << pin); // Set as output
    const newValue = pinValue ? (value | (1 << pin)) : (value & ~(1 << pin));

    this.gpioSet(enable, newDir, newValue);
  }

  /**
   * Read GPIO pin
   */
  gpioRead(pin: number): GPIOState {
    if (pin < 0 || pin > 7) {
      throw new Error('Pin must be 0-7');
    }

    const { direction, value } = this.gpioGet();

    return {
      pin,
      direction: (direction & (1 << pin)) ? 'output' : 'input',
      value: !!(value & (1 << pin)),
    };
  }
}
