/**
 * CH347 SPI Interface
 *
 * Protocol based on official WCH SDK and flashrom implementation.
 * Commands:
 *   0xC0 - SPI_SET_CFG: Configure SPI
 *   0xC1 - SPI_CS_CTRL: Chip select control
 *   0xC2 - SPI_OUT_IN: Bidirectional transfer
 *   0xC3 - SPI_IN: Read only
 *   0xC4 - SPI_OUT: Write only
 *   0xCA - SPI_GET_CFG: Get configuration
 */

import { CH347USB } from './usb';
import {
  CH347_CMD_SPI_SET_CFG,
  CH347_CMD_SPI_CS_CTRL,
  CH347_CMD_SPI_OUT_IN,
  CH347_CMD_SPI_IN,
  CH347_CMD_SPI_OUT,
  CH347_CMD_SPI_GET_CFG,
  CH347_CS_ASSERT,
  CH347_CS_DEASSERT,
  CH347_CS_CHANGE,
  CH347_PACKET_SIZE,
  SPISpeed,
  SPIMode,
} from './constants';
import { SPIConfig } from './types';

// Default SPI configuration
const DEFAULT_SPI_CONFIG: SPIConfig = {
  speed: SPISpeed.CLK_15M,
  mode: SPIMode.MODE_0,
  chipSelect: 0,
  bitOrder: 'MSB',
};

export class CH347SPI {
  private usb: CH347USB;
  private config: SPIConfig;
  private isInitialized = false;

  constructor(usb: CH347USB, config?: Partial<SPIConfig>) {
    this.usb = usb;
    this.config = { ...DEFAULT_SPI_CONFIG, ...config };
  }

  /**
   * Initialize SPI interface with configuration
   */
  async init(config?: Partial<SPIConfig>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Build SPI configuration packet (29 bytes total)
    const cfgBuf = Buffer.alloc(29);
    cfgBuf[0] = this.config.mode; // SPI Mode 0/1/2/3
    cfgBuf[1] = this.config.speed; // Clock divisor
    cfgBuf[2] = this.config.bitOrder === 'LSB' ? 0 : 1; // Byte order: 0=LSB, 1=MSB
    cfgBuf[3] = 0; // SpiWriteReadInterval low byte
    cfgBuf[4] = 0; // SpiWriteReadInterval high byte
    cfgBuf[5] = 0xff; // SpiOutDefaultData
    cfgBuf[6] = (this.config.chipSelect === 0 ? 0x80 : 0x81); // ChipSelect: bit7=1 means valid, bit0=CS selection
    cfgBuf[7] = 0; // CS1 polarity (0=active low)
    cfgBuf[8] = 0; // CS2 polarity (0=active low)
    cfgBuf[9] = 0; // IsAutoDeactiveCS low byte
    cfgBuf[10] = 0; // IsAutoDeactiveCS high byte
    cfgBuf[11] = 0; // ActiveDelay low byte
    cfgBuf[12] = 0; // ActiveDelay high byte
    cfgBuf[13] = 0; // DelayDeactive byte 0
    cfgBuf[14] = 0; // DelayDeactive byte 1
    cfgBuf[15] = 0; // DelayDeactive byte 2
    cfgBuf[16] = 0; // DelayDeactive byte 3

    // Build command packet
    const cmdLen = 3 + cfgBuf.length;
    const cmdBuf = Buffer.alloc(cmdLen);
    cmdBuf[0] = CH347_CMD_SPI_SET_CFG;
    cmdBuf[1] = cfgBuf.length & 0xff; // Length low byte
    cmdBuf[2] = (cfgBuf.length >> 8) & 0xff; // Length high byte
    cfgBuf.copy(cmdBuf, 3);

    await this.usb.write(cmdBuf);
    const response = await this.usb.read(4);

    // Check response
    if (response[0] !== CH347_CMD_SPI_SET_CFG || response[3] !== 0) {
      throw new Error('Failed to configure SPI');
    }

    this.isInitialized = true;
  }

  /**
   * Control chip select
   */
  async setChipSelect(active: boolean): Promise<void> {
    const cmdBuf = Buffer.alloc(4);
    cmdBuf[0] = CH347_CMD_SPI_CS_CTRL;
    cmdBuf[1] = 1; // Length
    cmdBuf[2] = 0;
    cmdBuf[3] = CH347_CS_CHANGE | (active ? CH347_CS_ASSERT : CH347_CS_DEASSERT);

    await this.usb.write(cmdBuf);
    await this.usb.read(4);
  }

  /**
   * SPI write and read (full duplex transfer)
   * @param data Data to write
   * @param csControl If true, automatically control CS (default true)
   * @returns Data read during transfer
   */
  async writeRead(data: Buffer, csControl = true): Promise<Buffer> {
    if (!this.isInitialized) {
      await this.init();
    }

    const result = Buffer.alloc(data.length);
    let offset = 0;
    const maxPayload = CH347_PACKET_SIZE - 3; // Command header is 3 bytes

    // Control CS
    const csFlag = csControl ? 0x80 : 0x00;

    while (offset < data.length) {
      const chunkSize = Math.min(data.length - offset, maxPayload);
      const chunk = data.subarray(offset, offset + chunkSize);

      // Build command packet
      const cmdBuf = Buffer.alloc(3 + chunkSize);
      cmdBuf[0] = CH347_CMD_SPI_OUT_IN;
      cmdBuf[1] = chunkSize & 0xff;
      cmdBuf[2] = ((chunkSize >> 8) & 0xff) | csFlag;
      chunk.copy(cmdBuf, 3);

      await this.usb.write(cmdBuf);
      const response = await this.usb.read(CH347_PACKET_SIZE);

      // Extract data from response
      if (response[0] === CH347_CMD_SPI_OUT_IN) {
        const responseLen = response[1] | (response[2] << 8);
        response.copy(result, offset, 3, 3 + Math.min(responseLen, chunkSize));
      }

      offset += chunkSize;
    }

    return result;
  }

  /**
   * SPI write only
   * @param data Data to write
   * @param csControl If true, automatically control CS (default true)
   */
  async write(data: Buffer, csControl = true): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }

    const maxPayload = CH347_PACKET_SIZE - 3;
    const csFlag = csControl ? 0x80 : 0x00;
    let offset = 0;

    while (offset < data.length) {
      const chunkSize = Math.min(data.length - offset, maxPayload);
      const chunk = data.subarray(offset, offset + chunkSize);

      const cmdBuf = Buffer.alloc(3 + chunkSize);
      cmdBuf[0] = CH347_CMD_SPI_OUT;
      cmdBuf[1] = chunkSize & 0xff;
      cmdBuf[2] = ((chunkSize >> 8) & 0xff) | csFlag;
      chunk.copy(cmdBuf, 3);

      await this.usb.write(cmdBuf);
      await this.usb.read(4); // Read acknowledgment

      offset += chunkSize;
    }
  }

  /**
   * SPI read only
   * @param length Number of bytes to read
   * @param csControl If true, automatically control CS (default true)
   * @returns Data read
   */
  async read(length: number, csControl = true): Promise<Buffer> {
    if (!this.isInitialized) {
      await this.init();
    }

    const result = Buffer.alloc(length);
    const maxPayload = CH347_PACKET_SIZE - 3;
    const csFlag = csControl ? 0x80 : 0x00;
    let offset = 0;

    while (offset < length) {
      const chunkSize = Math.min(length - offset, maxPayload);

      const cmdBuf = Buffer.alloc(7);
      cmdBuf[0] = CH347_CMD_SPI_IN;
      cmdBuf[1] = 4; // Length of parameters
      cmdBuf[2] = csFlag;
      cmdBuf[3] = chunkSize & 0xff;
      cmdBuf[4] = (chunkSize >> 8) & 0xff;
      cmdBuf[5] = (chunkSize >> 16) & 0xff;
      cmdBuf[6] = (chunkSize >> 24) & 0xff;

      await this.usb.write(cmdBuf);
      const response = await this.usb.read(CH347_PACKET_SIZE);

      if (response[0] === CH347_CMD_SPI_IN) {
        const responseLen = response[1] | (response[2] << 8);
        response.copy(result, offset, 3, 3 + Math.min(responseLen, chunkSize));
      }

      offset += chunkSize;
    }

    return result;
  }

  /**
   * Execute SPI command with CS control
   * Useful for sending flash commands
   */
  async command(writeData: Buffer, readLength = 0): Promise<Buffer> {
    await this.setChipSelect(true);

    try {
      if (readLength === 0) {
        // Write only
        await this.write(writeData, false);
        return Buffer.alloc(0);
      } else {
        // Write then read
        await this.write(writeData, false);
        return await this.read(readLength, false);
      }
    } finally {
      await this.setChipSelect(false);
    }
  }

  /**
   * Execute SPI command with full duplex transfer
   */
  async transfer(data: Buffer): Promise<Buffer> {
    await this.setChipSelect(true);
    try {
      return await this.writeRead(data, false);
    } finally {
      await this.setChipSelect(false);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): SPIConfig {
    return { ...this.config };
  }

  /**
   * Check if SPI is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}
