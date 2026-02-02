/**
 * CH347 SPI Interface
 *
 * Protocol based on flashrom ch347_spi.c implementation.
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
  CH347_CS_ASSERT,
  CH347_CS_DEASSERT,
  CH347_CS_CHANGE,
  CH347_CS_IGNORE,
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
   * Configuration packet structure based on flashrom ch347_spi.c
   */
  async init(config?: Partial<SPIConfig>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Extract clock polarity and phase from SPI mode
    const cpol = (this.config.mode >> 1) & 1; // bit 1 = CPOL
    const cpha = this.config.mode & 1;        // bit 0 = CPHA

    // Build SPI configuration packet (29 bytes total, matching flashrom)
    // Structure based on analysis of from vendor driver
    const buff = Buffer.alloc(29);
    buff[0] = CH347_CMD_SPI_SET_CFG;
    buff[1] = (buff.length - 3) & 0xff;         // payload length low byte (26)
    buff[2] = ((buff.length - 3) >> 8) & 0xff;  // payload length high byte (0)

    // Mystery bytes that vendor drivers unconditionally set
    buff[5] = 4;
    buff[6] = 1;

    // Clock polarity: bit 1
    buff[9] = cpol;

    // Clock phase: bit 0
    buff[11] = cpha;

    // Another mystery byte
    buff[14] = 2;

    // Clock divisor: bits 5:3
    buff[15] = (this.config.speed & 0x7) << 3;

    // Bit order: bit 7, 0=MSB, 0x80=LSB
    buff[17] = this.config.bitOrder === 'LSB' ? 0x80 : 0;

    // Yet another mystery byte
    buff[19] = 7;

    // CS polarity: bit 7 = CS2, bit 6 = CS1. 0 = active low
    buff[24] = 0;

    await this.usb.write(buff);

    // Read response (flashrom reads into same size buffer)
    const response = await this.usb.read(29);

    // FIXME: Not sure if the CH347 sends error responses for
    // invalid config data, if so the code should check
    if (response.length < 3) {
      throw new Error('Failed to configure SPI: invalid response');
    }

    this.isInitialized = true;
  }

  /**
   * Control chip select (dual CS support like flashrom)
   * @param cs1 CS1 control flags (CH347_CS_ASSERT/DEASSERT | CH347_CS_CHANGE)
   * @param cs2 CS2 control flags (CH347_CS_IGNORE or CH347_CS_ASSERT/DEASSERT | CH347_CS_CHANGE)
   */
  async csControl(cs1: number, cs2: number = CH347_CS_IGNORE): Promise<void> {
    // 13-byte CS control command (matching flashrom)
    const cmd = Buffer.alloc(13);
    cmd[0] = CH347_CMD_SPI_CS_CTRL;
    cmd[1] = 10;  // payload length (uint16 LSB)
    cmd[2] = 0;   // payload length high byte
    cmd[3] = cs1;
    cmd[8] = cs2;

    await this.usb.write(cmd);
  }

  /**
   * Control chip select (simplified interface)
   * @param active true to assert CS, false to deassert
   */
  async setChipSelect(active: boolean): Promise<void> {
    const cs1 = (active ? CH347_CS_ASSERT : CH347_CS_DEASSERT) | CH347_CS_CHANGE;
    await this.csControl(cs1, CH347_CS_IGNORE);
  }

  /**
   * SPI write only (matching flashrom ch347_write)
   * @param data Data to write
   */
  async write(data: Buffer): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }

    // Dynamically adapt chunk size based on USB speed (High-Speed vs Full-Speed)
    const maxDataLen = this.usb.getMaxDataLen();
    let bytesWritten = 0;

    while (bytesWritten < data.length) {
      const dataLen = Math.min(maxDataLen, data.length - bytesWritten);
      const packetLen = dataLen + 3;

      const buffer = Buffer.alloc(packetLen);
      buffer[0] = CH347_CMD_SPI_OUT;
      buffer[1] = dataLen & 0xff;
      buffer[2] = (dataLen >> 8) & 0xff;
      data.copy(buffer, 3, bytesWritten, bytesWritten + dataLen);

      await this.usb.write(buffer);

      // Read acknowledgment
      const resp = await this.usb.read(4);
      if (resp.length < 4) {
        throw new Error('Could not receive write command response');
      }

      bytesWritten += dataLen;
    }
  }

  /**
   * SPI read only (matching flashrom ch347_read)
   * @param length Number of bytes to read
   * @returns Data read
   */
  async read(length: number): Promise<Buffer> {
    const debug = process.env.DEBUG_SPI === '1';
    if (!this.isInitialized) {
      await this.init();
    }

    const result = Buffer.alloc(length);
    let bytesRead = 0;

    // Dynamically adapt chunk size based on USB speed (High-Speed vs Full-Speed)
    const maxChunkSize = this.usb.getMaxDataLen();

    while (bytesRead < length) {
      const chunkLen = Math.min(maxChunkSize, length - bytesRead);

      // Send read command for this chunk
      const commandBuf = Buffer.alloc(7);
      commandBuf[0] = CH347_CMD_SPI_IN;
      commandBuf[1] = 4;  // length of parameters
      commandBuf[2] = 0;
      commandBuf[3] = chunkLen & 0xff;
      commandBuf[4] = (chunkLen >> 8) & 0xff;
      commandBuf[5] = (chunkLen >> 16) & 0xff;
      commandBuf[6] = (chunkLen >> 24) & 0xff;

      if (debug) console.log(`[SPI.read] Requesting ${chunkLen} bytes (${bytesRead}/${length})...`);
      await this.usb.write(commandBuf);

      // Read response
      const response = await this.usb.read(CH347_PACKET_SIZE);
      if (debug) console.log(`[SPI.read] Got ${response.length} bytes`);

      // Response: u8 command, u16 data length, then the data that was read
      if (response.length < 3) {
        throw new Error('CH347 returned an invalid response to read command');
      }

      const ch347DataLength = response[1] | (response[2] << 8);
      if (response.length - 3 < ch347DataLength) {
        throw new Error('CH347 returned less data than data length header indicates');
      }

      if (ch347DataLength > chunkLen) {
        throw new Error('CH347 returned more bytes than requested');
      }

      response.copy(result, bytesRead, 3, 3 + ch347DataLength);
      bytesRead += ch347DataLength;
    }

    return result;
  }

  /**
   * SPI write and read (full duplex transfer)
   * Note: This is not used by flashrom but kept for compatibility
   * @param data Data to write
   * @returns Data read during transfer
   */
  async writeRead(data: Buffer): Promise<Buffer> {
    if (!this.isInitialized) {
      await this.init();
    }

    const result = Buffer.alloc(data.length);
    let offset = 0;
    const maxDataLen = this.usb.getMaxDataLen();

    while (offset < data.length) {
      const chunkSize = Math.min(data.length - offset, maxDataLen);
      const chunk = data.subarray(offset, offset + chunkSize);

      // Build command packet
      const cmdBuf = Buffer.alloc(3 + chunkSize);
      cmdBuf[0] = CH347_CMD_SPI_OUT_IN;
      cmdBuf[1] = chunkSize & 0xff;
      cmdBuf[2] = (chunkSize >> 8) & 0xff;
      chunk.copy(cmdBuf, 3);

      await this.usb.write(cmdBuf);
      const response = await this.usb.read(CH347_PACKET_SIZE);

      // Validate response
      if (response.length < 3) {
        throw new Error('CH347 returned an invalid response to writeRead command');
      }

      if (response[0] === CH347_CMD_SPI_OUT_IN) {
        const responseLen = response[1] | (response[2] << 8);
        if (response.length - 3 < responseLen) {
          throw new Error('CH347 returned less data than data length header indicates');
        }
        response.copy(result, offset, 3, 3 + Math.min(responseLen, chunkSize));
      }

      offset += chunkSize;
    }

    return result;
  }

  /**
   * Execute SPI command (matching flashrom ch347_spi_send_command)
   * This is the main interface for flash operations
   * @param writeData Data to write (command + address + data)
   * @param readLength Number of bytes to read after write
   * @returns Data read (empty buffer if readLength is 0)
   */
  async sendCommand(writeData: Buffer, readLength = 0): Promise<Buffer> {
    const debug = process.env.DEBUG_SPI === '1';
    if (debug) console.log(`[SPI] sendCommand: write ${writeData.length} bytes, read ${readLength} bytes`);

    // Assert CS
    if (debug) console.log('[SPI] Asserting CS...');
    await this.csControl(CH347_CS_ASSERT | CH347_CS_CHANGE, CH347_CS_IGNORE);
    if (debug) console.log('[SPI] CS asserted');

    try {
      // Write phase
      if (writeData.length > 0) {
        if (debug) console.log(`[SPI] Writing ${writeData.length} bytes...`);
        await this.write(writeData);
        if (debug) console.log('[SPI] Write complete');
      }

      // Read phase
      if (readLength > 0) {
        if (debug) console.log(`[SPI] Reading ${readLength} bytes...`);
        const result = await this.read(readLength);
        if (debug) console.log('[SPI] Read complete');
        return result;
      }

      return Buffer.alloc(0);
    } finally {
      // Deassert CS
      if (debug) console.log('[SPI] Deasserting CS...');
      await this.csControl(CH347_CS_DEASSERT | CH347_CS_CHANGE, CH347_CS_IGNORE);
      if (debug) console.log('[SPI] CS deasserted');
    }
  }

  /**
   * Legacy command interface (for backwards compatibility)
   * @deprecated Use sendCommand instead
   */
  async command(writeData: Buffer, readLength = 0): Promise<Buffer> {
    return this.sendCommand(writeData, readLength);
  }

  /**
   * Execute SPI command with full duplex transfer
   */
  async transfer(data: Buffer): Promise<Buffer> {
    await this.setChipSelect(true);
    try {
      return await this.writeRead(data);
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
