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

/**
 * Call a koffi function asynchronously (runs on worker thread)
 * Converts callback-style async to Promise
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function callAsync<T>(fn: any, ...args: any[]): Promise<T> {
  return new Promise((resolve, reject) => {
    fn.async(...args, (err: Error | null, result: T) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// Unified interface for DLL functions
interface WCHFunctions {
  CH347OpenDevice: (deviceIndex: number) => number;
  CH347CloseDevice: (deviceIndex: number) => void;
  CH347GetDeviceInfor: (deviceIndex: number, deviceInfo: Buffer | Uint8Array) => number;
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
  CH347SPI_SetFrequency: (deviceIndex: number, spiSpeedHz: number) => number;
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
        CH347GetDeviceInfor: lib.func('int CH347GetDeviceInfor(int, void*)'),
        CH347SPI_Init: lib.func('int CH347SPI_Init(int, void*)'),
        CH347SPI_SetChipSelect: lib.func('int CH347SPI_SetChipSelect(int, int, int, int, int)'),
        CH347SPI_Write: lib.func('int CH347SPI_Write(int, int, int, int, void*)'),
        CH347SPI_Read: lib.func('int CH347SPI_Read(int, int, uint32, uint32*, void*)'),
        CH347SPI_WriteRead: lib.func('int CH347SPI_WriteRead(int, int, int, void*)'),
        CH347GPIO_Set: lib.func('int CH347GPIO_Set(int, int, int, int)'),
        CH347GPIO_Get: lib.func('int CH347GPIO_Get(int, void*, void*)'),
        CH347SPI_SetFrequency: lib.func('int CH347SPI_SetFrequency(int, int)'),
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
 * Get WCH DLL functions
 */
export function getWCHFunctions(): WCHFunctions | null {
  return wchLib;
}

/**
 * WCH DLL-based CH347 USB implementation
 */
export class CH347WCH {
  private deviceIndex: number = -1;
  private isOpen = false;
  private pending: Promise<void> = Promise.resolve();
  private spiConfig: Partial<SPIConfig> | undefined;

  /**
   * Serialize DLL calls to prevent concurrent access
   * WCH DLL may not be thread-safe, so we queue all operations
   */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.pending.then(fn);
    this.pending = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  /**
   * List available CH347 devices
   * Note: WCH DLL doesn't have a proper enumeration function,
   * so we try to open devices 0-15 to check availability
   */
  static async listDevices(): Promise<number[]> {
    if (!loadWCHDLL()) {
      throw dllLoadError;
    }

    const devices: number[] = [];
    for (let i = 0; i < 16; i++) {
      const handle = await callAsync<number>(wchLib!.CH347OpenDevice, i);
      // CH347OpenDevice returns 0 on failure, non-zero handle on success
      if (handle !== 0 && handle !== -1) {
        devices.push(i);
        await callAsync<void>(wchLib!.CH347CloseDevice, i);
      }
    }
    return devices;
  }

  /**
   * Open connection to CH347 device
   */
  async open(deviceIndex = 0): Promise<void> {
    if (!loadWCHDLL()) {
      throw dllLoadError;
    }

    const handle = await callAsync<number>(wchLib!.CH347OpenDevice, deviceIndex);

    // CH347OpenDevice returns 0 on failure, non-zero handle on success
    if (handle === 0 || handle === -1) {
      throw new Error(`Failed to open CH347 device ${deviceIndex} (handle=${handle})`);
    }

    this.deviceIndex = deviceIndex;
    this.isOpen = true;
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    if (this.isOpen && this.deviceIndex >= 0) {
      await callAsync<void>(wchLib!.CH347CloseDevice, this.deviceIndex);
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
  async spiInit(config?: Partial<SPIConfig>): Promise<void> {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    // Save config for later use (e.g., when spiSetFrequency needs to reinitialize)
    this.spiConfig = config;

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

    const result = await this.serialize(() =>
      callAsync<number>(wchLib!.CH347SPI_Init, this.deviceIndex, cfgBuffer)
    );

    if (result === 0) {
      throw new Error(`Failed to initialize SPI (device=${this.deviceIndex}, result=${result})`);
    }
  }

  /**
   * Set SPI clock frequency
   *
   * Supported frequencies (nearest value is automatically selected):
   * 60 MHz, 48 MHz, 36 MHz, 30 MHz, 28 MHz, 24 MHz, 18 MHz, 15 MHz, 14 MHz,
   * 12 MHz, 9 MHz, 7.5 MHz, 7 MHz, 6 MHz, 4.5 MHz, 3.75 MHz, 3.5 MHz, 3 MHz,
   * 2.25 MHz, 1.875 MHz, 1.75 MHz, 1.5 MHz, 1.125 MHz, 937.5 KHz, 875 KHz,
   * 750 KHz, 562.5 KHz, 468.75 KHz, 437.5 KHz, 375 KHz, 281.25 KHz, 218.75 KHz
   *
   * This method automatically calls spiInit() after setting the frequency
   * as required by the CH347 DLL, using the previously saved SPI configuration.
   *
   * @param frequencyHz - Desired SPI clock frequency in Hz
   * @throws Error if device is not open or operation fails
   */
  async spiSetFrequency(frequencyHz: number): Promise<void> {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    const result = await this.serialize(() =>
      callAsync<number>(
        wchLib!.CH347SPI_SetFrequency,
        this.deviceIndex,
        frequencyHz
      )
    );

    if (result === 0) {
      throw new Error(`Failed to set SPI frequency to ${frequencyHz} Hz`);
    }

    // Per CH347 documentation: must call CH347SPI_Init after setting frequency
    await this.spiInit(this.spiConfig);
  }

  /**
   * SPI full-duplex transfer - uses CH347SPI_WriteRead (0xC2 command)
   *
   * This sends data on MOSI while simultaneously receiving on MISO.
   * The buffer is both input (TX) and output (RX).
   *
   * USB sequence:
   *   USB OUT: [0xC1] CS Assert
   *   USB OUT: [0xC2][len_lo][len_hi][tx_data...]
   *   USB IN:  [0xC2][len_lo][len_hi][rx_data...]
   *   USB OUT: [0xC1] CS Deassert
   *
   * Use this for true full-duplex operations where you need simultaneous TX/RX.
   * For write-then-read patterns (like flash commands), use sendCommand() instead.
   */
  async spiTransfer(writeData: Buffer): Promise<Buffer> {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    const debug = process.env.DEBUG_WCH === '1';
    const ioBuffer = Buffer.alloc(writeData.length);
    writeData.copy(ioBuffer);

    if (debug) {
      console.log(`[WCH] spiTransfer: deviceIndex=${this.deviceIndex}, len=${writeData.length}, data=${writeData.subarray(0, Math.min(8, writeData.length)).toString('hex')}...`);
    }

    const result = await this.serialize(() =>
      callAsync<number>(
        wchLib!.CH347SPI_WriteRead,
        this.deviceIndex,
        0x80, // CS0 active
        writeData.length,
        ioBuffer
      )
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
   * SPI write only - uses CH347SPI_Write (0xC4 command)
   *
   * This matches the libusb sequence:
   *   USB OUT: [0xC1] CS Assert
   *   USB OUT: [0xC4][len_lo][len_hi][data...]
   *   USB IN:  [0xC4][...] ack
   *   USB OUT: [0xC1] CS Deassert
   *
   * CH347SPI_Write with csControl=0x80 handles CS automatically.
   */
  async spiWrite(data: Buffer): Promise<void> {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    const debug = process.env.DEBUG_WCH === '1';

    const buffer = Buffer.alloc(data.length);
    data.copy(buffer);

    if (debug) {
      console.log(`[WCH] spiWrite: deviceIndex=${this.deviceIndex}, len=${data.length}, data=${data.subarray(0, Math.min(8, data.length)).toString('hex')}...`);
    }

    // Use CH347SPI_Write
    // Parameters: deviceIndex, csControl, cmdLength, dataLength, buffer
    // cmdLength = chunk size for writing (pass data.length for single chunk)
    // dataLength = total bytes to write
    const result = await this.serialize(() =>
      callAsync<number>(
        wchLib!.CH347SPI_Write,
        this.deviceIndex,
        0x80,        // CS0 active (bit 7 set) - DLL handles CS assert/deassert
        data.length, // cmdLength: chunk size (use full buffer as one chunk)
        data.length, // dataLength: total bytes to write
        buffer
      )
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
  async spiRead(length: number): Promise<Buffer> {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    const readBuffer = Buffer.alloc(length);
    const lengthPtr = new Uint32Array([length]);

    const result = await this.serialize(() =>
      callAsync<number>(
        wchLib!.CH347SPI_Read,
        this.deviceIndex,
        0x80, // CS0 active
        0, // No command bytes
        lengthPtr,
        readBuffer
      )
    );

    if (result === 0) {
      throw new Error('SPI read failed');
    }

    return readBuffer;
  }

  /**
   * SPI read with command - uses CH347SPI_Read (0xC4 + 0xC3 internally)
   *
   * This matches the libusb sendCommand() sequence for read operations:
   *   USB OUT: [0xC1] CS Assert
   *   USB OUT: [0xC4][cmd_len][0x00][command...]  (write command bytes)
   *   USB IN:  [0xC4][...] ack
   *   USB OUT: [0xC3][0x04][0x00][read_len as u32]  (request read)
   *   USB IN:  [0xC3][len_lo][len_hi][data...]
   *   USB OUT: [0xC1] CS Deassert
   *
   * CH347SPI_Read combines the write-command and read-data phases in one CS assertion.
   *
   * @param command Command buffer (e.g., [0x03, addr_high, addr_mid, addr_low])
   * @param readLength Number of bytes to read after the command
   * @returns Data read from device
   */
  async spiReadWithCommand(command: Buffer, readLength: number): Promise<Buffer> {
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
    // - oLength: command length (number of bytes to send first via 0xC4)
    // - iLength: pointer to read length (bytes to read via 0xC3)
    // - ioBuffer: contains command at start, receives data
    const result = await this.serialize(() =>
      callAsync<number>(
        wchLib!.CH347SPI_Read,
        this.deviceIndex,
        0x80, // CS0 active - DLL handles CS assert/deassert
        command.length, // Command length to write first
        readLengthPtr, // Pointer to read length
        ioBuffer
      )
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

    // The ioBuffer contains the read data starting from the beginning
    return ioBuffer.subarray(0, actualReadLen);
  }

  /**
   * Send SPI command with optional read - uses CH347SPI_WriteRead (0xC2 full-duplex)
   *
   * Always uses CH347SPI_WriteRead for both write-only and write-then-read operations.
   * CH347SPI_Write (0xC4) is unreliable under sustained heavy write load, causing
   * sporadic data corruption in page writes.
   *
   * For write-then-read:
   *   We send: [cmd bytes][dummy bytes for clocking]
   *   We recv: [garbage during cmd][actual read data]
   *
   * @param writeData Command/data to write
   * @param readLength Number of bytes to read (0 for write-only)
   * @returns Read data (empty buffer if readLength is 0)
   */
  async sendCommand(writeData: Buffer, readLength = 0): Promise<Buffer> {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    // Always use CH347SPI_WriteRead (0xC2 full-duplex) for all operations.
    // CH347SPI_Write (0xC4) is unreliable under sustained heavy write load,
    // causing sporadic data corruption in page writes.
    const totalLen = writeData.length + readLength;
    const ioBuffer = Buffer.alloc(totalLen);
    writeData.copy(ioBuffer); // Command at start, rest is 0x00 (dummy for clocking)

    const result = await this.serialize(() =>
      callAsync<number>(
        wchLib!.CH347SPI_WriteRead,
        this.deviceIndex,
        0x80, // CS0 active - DLL handles CS
        totalLen,
        ioBuffer
      )
    );

    if (result === 0) {
      throw new Error(`SPI WriteRead failed (cmd=0x${writeData[0]?.toString(16)})`);
    }

    if (readLength === 0) {
      return Buffer.alloc(0);
    }

    // Read data comes after the command bytes (those clocks received garbage)
    return ioBuffer.subarray(writeData.length, writeData.length + readLength);
  }

  /**
   * Control chip select
   */
  async setChipSelect(active: boolean, csIndex: 0 | 1 = 0): Promise<void> {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    const result = await this.serialize(() =>
      callAsync<number>(
        wchLib!.CH347SPI_SetChipSelect,
        this.deviceIndex,
        1, // Enable
        csIndex,
        active ? 0 : 1, // Idle state
        active ? 1 : 0 // Active state
      )
    );

    if (result === 0) {
      throw new Error('Failed to set chip select');
    }
  }

  /**
   * Set GPIO pins
   */
  async gpioSet(enable: number, direction: number, value: number): Promise<void> {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    const result = await this.serialize(() =>
      callAsync<number>(
        wchLib!.CH347GPIO_Set,
        this.deviceIndex,
        enable,
        direction,
        value
      )
    );

    if (result === 0) {
      throw new Error('Failed to set GPIO');
    }
  }

  /**
   * Get GPIO state
   */
  async gpioGet(): Promise<{ direction: number; value: number }> {
    if (!this.isOpen) {
      throw new Error('Device not open');
    }

    const dirBuffer = Buffer.alloc(1);
    const dataBuffer = Buffer.alloc(1);

    const result = await this.serialize(() =>
      callAsync<number>(
        wchLib!.CH347GPIO_Get,
        this.deviceIndex,
        dirBuffer,
        dataBuffer
      )
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
  async gpioReadAll(): Promise<GPIOState[]> {
    const { direction, value } = await this.gpioGet();
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
  async gpioWrite(pin: number, pinValue: boolean): Promise<void> {
    if (pin < 0 || pin > 7) {
      throw new Error('Pin must be 0-7');
    }

    const { direction, value } = await this.gpioGet();
    const enable = 1 << pin;
    const newDir = direction | (1 << pin); // Set as output
    const newValue = pinValue ? (value | (1 << pin)) : (value & ~(1 << pin));

    await this.gpioSet(enable, newDir, newValue);
  }

  /**
   * Read GPIO pin
   */
  async gpioRead(pin: number): Promise<GPIOState> {
    if (pin < 0 || pin > 7) {
      throw new Error('Pin must be 0-7');
    }

    const { direction, value } = await this.gpioGet();

    return {
      pin,
      direction: (direction & (1 << pin)) ? 'output' : 'input',
      value: !!(value & (1 << pin)),
    };
  }
}
