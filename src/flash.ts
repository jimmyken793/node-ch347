/**
 * CH347 SPI Flash Programmer
 *
 * Supports common SPI flash chips (W25Qxx, GD25Qxx, MX25Lxx, etc.)
 */

import * as fs from 'fs/promises';
import {
  FLASH_CMD_WRITE_ENABLE,
  FLASH_CMD_WRITE_DISABLE,
  FLASH_CMD_READ_STATUS,
  FLASH_CMD_READ_DATA,
  FLASH_CMD_PAGE_PROGRAM,
  FLASH_CMD_SECTOR_ERASE,
  FLASH_CMD_BLOCK_ERASE_32K,
  FLASH_CMD_BLOCK_ERASE_64K,
  FLASH_CMD_CHIP_ERASE,
  FLASH_CMD_READ_JEDEC_ID,
  FLASH_CMD_READ_SFDP,
  FLASH_STATUS_WIP,
  FLASH_STATUS_WEL,
  FLASH_PAGE_SIZE,
  FLASH_SECTOR_SIZE,
  FLASH_BLOCK_SIZE_32K,
  FLASH_BLOCK_SIZE_64K,
} from './constants';
import {
  FlashInfo,
  EraseType,
  FlashProgressCallback,
  FlashManufacturers,
  FlashDatabase,
  SPIInterface,
} from './types';
import { on } from 'events';

const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds for chip erase
const POLL_INTERVAL_MS = 1; // 1ms polling

export class CH347Flash {
  private spi: SPIInterface;
  private flashInfo: FlashInfo | null = null;

  constructor(spi: SPIInterface) {
    this.spi = spi;
  }

  /**
   * Read JEDEC ID from flash chip
   */
  async readJedecId(): Promise<FlashInfo> {
    // Send JEDEC ID command (1 byte), read 3 bytes response
    const cmd = Buffer.from([FLASH_CMD_READ_JEDEC_ID]);
    const response = await this.spi.sendCommand(cmd, 3);

    const manufacturerId = response[0];
    const memoryType = response[1];
    const capacity = response[2];
    const jedecId = (manufacturerId << 16) | (memoryType << 8) | capacity;

    // Look up in database
    const dbEntry = FlashDatabase[jedecId];
    let size = 0;
    let name: string | undefined;

    if (dbEntry) {
      size = dbEntry.size;
      name = dbEntry.name;
    } else {
      // Calculate size from capacity byte (2^capacity bytes)
      size = capacity > 0 ? 1 << capacity : 0;
    }

    const manufacturerName = FlashManufacturers[manufacturerId];
    if (!name && manufacturerName) {
      name = `${manufacturerName} (0x${jedecId.toString(16)})`;
    }

    this.flashInfo = {
      manufacturerId,
      memoryType,
      capacity,
      jedecId,
      size,
      name,
    };

    // Try to read SFDP parameters (disabled for now - may cause device state issues)
    // await this.readSFDPBasicParams();

    return this.flashInfo;
  }

  /**
   * Read SFDP (Serial Flash Discoverable Parameters) data
   * @param address 24-bit address in SFDP space
   * @param length Number of bytes to read
   */
  async readSFDP(address: number, length: number): Promise<Buffer> {
    // Command: 0x5A + 24-bit address + 1 dummy byte, then read data
    const cmd = Buffer.from([
      FLASH_CMD_READ_SFDP,
      (address >> 16) & 0xff,
      (address >> 8) & 0xff,
      address & 0xff,
      0x00, // dummy byte
    ]);

    return this.spi.sendCommand(cmd, length);
  }

  /**
   * Estimate erase timeout based on block size
   */
  private estimateEraseTimeout(size: number): number {
    if (size <= 4096) return 3000;        // 4KB: 3s
    if (size <= 32768) return 5000;       // 32KB: 5s
    if (size <= 65536) return 5000;       // 64KB: 5s
    return 10000;                         // Larger: 10s
  }

  /**
   * Read and parse SFDP Basic Flash Parameter Table
   * Populates flashInfo with discovered erase types and page size
   */
  private async readSFDPBasicParams(): Promise<void> {
    if (!this.flashInfo) return;

    try {
      // Read SFDP header (8 bytes at address 0x00)
      const header = await this.readSFDP(0, 8);

      // Validate signature "SFDP" (little-endian: 0x50444653)
      const signature = header.readUInt32LE(0);
      if (signature !== 0x50444653) {
        return; // SFDP not supported
      }

      // Read first parameter header (8 bytes at address 0x08)
      const paramHeader = await this.readSFDP(8, 8);
      const tableLength = paramHeader[3] * 4; // length in DWORDs -> bytes
      const tableAddress =
        paramHeader[4] | (paramHeader[5] << 8) | (paramHeader[6] << 16);

      // Read Basic Flash Parameter Table (BFPT)
      const bfpt = await this.readSFDP(tableAddress, Math.min(tableLength, 64));

      // Parse erase types from DWORDs 8-9 (bytes 28-35)
      // Each erase type is 2 bytes: [size_code, command]
      // size_code: 2^N bytes, command: erase opcode
      const eraseTypes: EraseType[] = [];
      for (let i = 0; i < 4; i++) {
        const offset = 28 + i * 2;
        if (offset + 1 >= bfpt.length) break;

        const sizeCode = bfpt[offset];     // 2^N bytes
        const command = bfpt[offset + 1];

        if (sizeCode > 0 && command > 0) {
          const size = 1 << sizeCode;
          eraseTypes.push({
            command,
            size,
            timeoutMs: this.estimateEraseTimeout(size),
          });
        }
      }

      // Parse page size from DWORD 11 (byte 40, bits 7-4)
      let pageSize = FLASH_PAGE_SIZE; // default 256
      if (bfpt.length > 40) {
        const pageSizeCode = (bfpt[40] >> 4) & 0x0f;
        if (pageSizeCode > 0) {
          pageSize = 1 << pageSizeCode;
        }
      }

      // Update flash info with SFDP data
      this.flashInfo.sfdpSupported = true;
      this.flashInfo.pageSize = pageSize;
      this.flashInfo.eraseTypes = eraseTypes.sort((a, b) => b.size - a.size);
    } catch {
      // SFDP read failed - chip may not support it, use defaults
      this.flashInfo.sfdpSupported = false;
    }
  }

  /**
   * Read status register
   */
  async readStatus(): Promise<number> {
    const cmd = Buffer.from([FLASH_CMD_READ_STATUS]);
    const response = await this.spi.sendCommand(cmd, 1);
    return response[0];
  }

  /**
   * Wait for flash to be ready (WIP bit cleared)
   */
  async waitReady(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    const startTime = Date.now();

    while (true) {
      const status = await this.readStatus();
      if ((status & FLASH_STATUS_WIP) === 0) {
        return;
      }

      if (Date.now() - startTime > timeoutMs) {
        throw new Error('Flash operation timeout');
      }

      await this.delay(POLL_INTERVAL_MS);
    }
  }

  /**
   * Enable write operations
   */
  async writeEnable(): Promise<void> {
    await this.spi.command(Buffer.from([FLASH_CMD_WRITE_ENABLE]));

    // Verify write enable latch is set
    const status = await this.readStatus();
    if ((status & FLASH_STATUS_WEL) === 0) {
      throw new Error('Failed to enable write');
    }
  }

  /**
   * Disable write operations
   */
  async writeDisable(): Promise<void> {
    await this.spi.command(Buffer.from([FLASH_CMD_WRITE_DISABLE]));
  }

  /**
   * Read data from flash
   */
  async read(
    address: number,
    length: number,
    onProgress?: FlashProgressCallback
  ): Promise<Buffer> {
    const result = Buffer.alloc(length);
    const chunkSize = 4096; // Read in 4KB chunks for progress reporting
    let offset = 0;

    while (offset < length) {
      const readLen = Math.min(chunkSize, length - offset);
      const addr = address + offset;

      // Build read command: 0x03 + 24-bit address
      const cmd = Buffer.from([
        FLASH_CMD_READ_DATA,
        (addr >> 16) & 0xff,
        (addr >> 8) & 0xff,
        addr & 0xff,
      ]);

      const response = await this.spi.sendCommand(cmd, readLen);
      response.copy(result, offset);

      offset += readLen;

      if (onProgress) {
        onProgress({
          operation: 'read',
          current: offset,
          total: length,
          percentage: Math.round((offset / length) * 100),
        });
      }
    }

    return result;
  }

  /**
   * Write a single page (up to 256 bytes)
   */
  private async writePage(address: number, data: Buffer): Promise<void> {
    if (data.length > FLASH_PAGE_SIZE) {
      throw new Error(`Data exceeds page size: ${data.length} > ${FLASH_PAGE_SIZE}`);
    }

    await this.writeEnable();

    // Build page program command
    const cmd = Buffer.alloc(4 + data.length);
    cmd[0] = FLASH_CMD_PAGE_PROGRAM;
    cmd[1] = (address >> 16) & 0xff;
    cmd[2] = (address >> 8) & 0xff;
    cmd[3] = address & 0xff;
    data.copy(cmd, 4);

    await this.spi.command(cmd);
    await this.waitReady(1000); // Page program timeout 1 second
  }

  /**
   * Write data to flash (handles page boundaries)
   */
  async write(
    address: number,
    data: Buffer,
    onProgress?: FlashProgressCallback
  ): Promise<void> {
    let offset = 0;

    while (offset < data.length) {
      // Calculate bytes remaining in current page
      const pageOffset = (address + offset) % FLASH_PAGE_SIZE;
      const pageRemaining = FLASH_PAGE_SIZE - pageOffset;
      const writeLen = Math.min(pageRemaining, data.length - offset);

      // Write page
      const chunk = data.subarray(offset, offset + writeLen);
      await this.writePage(address + offset, chunk);

      offset += writeLen;

      if (onProgress) {
        onProgress({
          operation: 'write',
          current: offset,
          total: data.length,
          percentage: Math.round((offset / data.length) * 100),
        });
      }
    }
  }

  /**
   * Erase a 4KB sector
   */
  async eraseSector(address: number): Promise<void> {
    // Align to sector boundary
    const sectorAddress = address & ~(FLASH_SECTOR_SIZE - 1);

    await this.writeEnable();

    const cmd = Buffer.from([
      FLASH_CMD_SECTOR_ERASE,
      (sectorAddress >> 16) & 0xff,
      (sectorAddress >> 8) & 0xff,
      sectorAddress & 0xff,
    ]);

    await this.spi.command(cmd);
    await this.waitReady(3000); // Sector erase timeout 3 seconds
  }

  /**
   * Erase a 32KB block
   */
  async eraseBlock32K(address: number): Promise<void> {
    const blockAddress = address & ~(FLASH_BLOCK_SIZE_32K - 1);

    await this.writeEnable();

    const cmd = Buffer.from([
      FLASH_CMD_BLOCK_ERASE_32K,
      (blockAddress >> 16) & 0xff,
      (blockAddress >> 8) & 0xff,
      blockAddress & 0xff,
    ]);

    await this.spi.command(cmd);
    await this.waitReady(5000); // Block erase timeout 5 seconds
  }

  /**
   * Erase a 64KB block
   */
  async eraseBlock64K(address: number): Promise<void> {
    const blockAddress = address & ~(FLASH_BLOCK_SIZE_64K - 1);

    await this.writeEnable();

    const cmd = Buffer.from([
      FLASH_CMD_BLOCK_ERASE_64K,
      (blockAddress >> 16) & 0xff,
      (blockAddress >> 8) & 0xff,
      blockAddress & 0xff,
    ]);

    await this.spi.command(cmd);
    await this.waitReady(5000); // Block erase timeout 5 seconds
  }

  /**
   * Erase entire chip
   */
  async eraseChip(onProgress?: FlashProgressCallback): Promise<void> {
    await this.writeEnable();
    await this.spi.command(Buffer.from([FLASH_CMD_CHIP_ERASE]));

    // Poll for completion with progress
    const startTime = Date.now();
    const timeout = DEFAULT_TIMEOUT_MS;

    while (true) {
      const status = await this.readStatus();
      if ((status & FLASH_STATUS_WIP) === 0) {
        if (onProgress) {
          onProgress({
            operation: 'erase',
            current: 100,
            total: 100,
            percentage: 100,
          });
        }
        return;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed > timeout) {
        throw new Error('Chip erase timeout');
      }

      if (onProgress) {
        // Estimate progress based on typical chip erase time
        const estimatedTime = 30000; // 30 seconds typical
        const progress = Math.min(99, Math.round((elapsed / estimatedTime) * 100));
        onProgress({
          operation: 'erase',
          current: progress,
          total: 100,
          percentage: progress,
        });
      }

      await this.delay(100);
    }
  }

  /**
   * Erase using a specific erase type (from SFDP discovery)
   */
  private async eraseWithType(address: number, eraseType: EraseType): Promise<void> {
    // Align to erase boundary
    const alignedAddress = address & ~(eraseType.size - 1);

    await this.writeEnable();

    const cmd = Buffer.from([
      eraseType.command,
      (alignedAddress >> 16) & 0xff,
      (alignedAddress >> 8) & 0xff,
      alignedAddress & 0xff,
    ]);

    await this.spi.command(cmd);
    await this.waitReady(eraseType.timeoutMs);
  }

  /**
   * Get default erase types (fallback when SFDP not available)
   */
  private getDefaultEraseTypes(): EraseType[] {
    return [
      { command: FLASH_CMD_BLOCK_ERASE_64K, size: FLASH_BLOCK_SIZE_64K, timeoutMs: 5000 },
      { command: FLASH_CMD_BLOCK_ERASE_32K, size: FLASH_BLOCK_SIZE_32K, timeoutMs: 5000 },
      { command: FLASH_CMD_SECTOR_ERASE, size: FLASH_SECTOR_SIZE, timeoutMs: 3000 },
    ];
  }

  /**
   * Erase range (uses optimal erase commands from SFDP or defaults)
   */
  async eraseRange(
    address: number,
    length: number,
    onProgress?: FlashProgressCallback
  ): Promise<void> {
    const endAddress = address + length;
    let currentAddress = address;
    let erased = 0;

    // Use SFDP-discovered erase types or fall back to defaults
    const eraseTypes = this.flashInfo?.eraseTypes ?? this.getDefaultEraseTypes();

    while (currentAddress < endAddress) {
      const remaining = endAddress - currentAddress;

      // Find the largest erase type that fits
      let usedEraseType: EraseType | null = null;
      for (const eraseType of eraseTypes) {
        if (
          (currentAddress % eraseType.size === 0) &&
          remaining >= eraseType.size
        ) {
          usedEraseType = eraseType;
          break; // eraseTypes are sorted by size descending
        }
      }

      if (usedEraseType) {
        await this.eraseWithType(currentAddress, usedEraseType);
        currentAddress += usedEraseType.size;
        erased += usedEraseType.size;
      } else {
        // Fallback to smallest erase type available
        const smallestErase = eraseTypes[eraseTypes.length - 1];
        await this.eraseWithType(currentAddress, smallestErase);
        currentAddress += smallestErase.size;
        erased += smallestErase.size;
      }

      if (onProgress) {
        onProgress({
          operation: 'erase',
          current: Math.min(erased, length),
          total: length,
          percentage: Math.round((Math.min(erased, length) / length) * 100),
        });
      }
    }
  }

  /**
   * Verify data matches flash contents
   */
  async verify(
    address: number,
    data: Buffer,
    onProgress?: FlashProgressCallback
  ): Promise<boolean> {
    const readData = await this.read(address, data.length, (progress) => {
      if (onProgress) {
        onProgress({
          ...progress,
          operation: 'verify',
        });
      }
    });

    if (!data.equals(readData)) {
      // Find and report first mismatches
      let mismatchCount = 0;
      let firstMismatch = -1;
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== readData[i]) {
          if (mismatchCount < 10) {
            console.log(`  Verify mismatch at 0x${(address + i).toString(16).padStart(6, '0')}: expected 0x${data[i].toString(16).padStart(2, '0')}, got 0x${readData[i].toString(16).padStart(2, '0')}`);
          }
          if (firstMismatch === -1) firstMismatch = i;
          mismatchCount++;
        }
      }
      console.log(`  Total mismatches: ${mismatchCount} / ${data.length} bytes (first at offset 0x${firstMismatch.toString(16)})`);

      // Check if readData is all 0xFF (not written) or old data
      const allFF = readData.subarray(firstMismatch, Math.min(firstMismatch + 16, data.length)).every(b => b === 0xFF);
      if (allFF) {
        console.log('  Flash appears to be erased (0xFF) - writes may not have taken effect');
      }

      return false;
    }

    return true;
  }

  /**
   * Check if a sector needs to be erased to write new data
   * Flash can only program 1→0, so we need to erase if any bit needs to go 0→1
   */
  private sectorNeedsErase(original: Buffer, newData: Buffer): boolean {
    for (let i = 0; i < newData.length; i++) {
      // If (original & new) !== new, some bits need to go from 0 to 1, requiring erase
      if ((original[i] & newData[i]) !== newData[i]) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a sector has any changes
   */
  private sectorHasChanges(original: Buffer, newData: Buffer): boolean {
    return !original.equals(newData);
  }

  /**
   * Program flash (smart erase + write + verify)
   * Only erases and writes sectors that have actual changes
   */
  async program(
    address: number,
    data: Buffer,
    options: {
      erase?: boolean;
      verify?: boolean;
      onProgress?: FlashProgressCallback;
    } = {}
  ): Promise<boolean> {
    const { erase = true, verify = true, onProgress } = options;
    // Read original content to compare
    const original = await this.read(address, data.length, onProgress);

    // Analyze which sectors need erasing and which need writing
    const sectorsToErase: number[] = [];
    const sectorsToWrite: number[] = [];

    const startSector = Math.floor(address / FLASH_SECTOR_SIZE);
    const endAddress = address + data.length;
    const endSector = Math.ceil(endAddress / FLASH_SECTOR_SIZE);

    for (let sector = startSector; sector < endSector; sector++) {
      const sectorStart = sector * FLASH_SECTOR_SIZE;
      const sectorEnd = sectorStart + FLASH_SECTOR_SIZE;

      // Calculate overlap between this sector and our data range
      const overlapStart = Math.max(sectorStart, address);
      const overlapEnd = Math.min(sectorEnd, endAddress);

      // Get the corresponding slices
      const dataOffset = overlapStart - address;
      const dataSlice = data.subarray(dataOffset, dataOffset + (overlapEnd - overlapStart));
      const originalSlice = original.subarray(dataOffset, dataOffset + (overlapEnd - overlapStart));

      if (this.sectorHasChanges(originalSlice, dataSlice)) {
        sectorsToWrite.push(sector);
        if (erase && this.sectorNeedsErase(originalSlice, dataSlice)) {
          sectorsToErase.push(sector);
        }
      }
    }

    // Calculate progress steps
    const totalWork = sectorsToErase.length + sectorsToWrite.length + (verify ? 1 : 0);
    let completedWork = 0;

    const reportProgress = (operation: 'erase' | 'write' | 'verify'): void => {
      if (onProgress) {
        onProgress({
          operation,
          current: completedWork,
          total: totalWork,
          percentage: totalWork > 0 ? Math.round((completedWork / totalWork) * 100) : 100,
        });
      }
    };

    // Erase only the sectors that need it
    for (const sector of sectorsToErase) {
      await this.eraseSector(sector * FLASH_SECTOR_SIZE);
      completedWork++;
      reportProgress('erase');
    }

    // Write only the sectors that have changes
    for (const sector of sectorsToWrite) {
      const sectorStart = sector * FLASH_SECTOR_SIZE;
      const sectorEnd = sectorStart + FLASH_SECTOR_SIZE;

      const overlapStart = Math.max(sectorStart, address);
      const overlapEnd = Math.min(sectorEnd, endAddress);

      const dataOffset = overlapStart - address;
      const dataSlice = data.subarray(dataOffset, dataOffset + (overlapEnd - overlapStart));

      await this.write(overlapStart, dataSlice);
      completedWork++;
      reportProgress('write');
    }

    // Verify
    if (verify) {
      const verified = await this.verify(address, data);
      completedWork++;
      reportProgress('verify');
      if (!verified) {
        throw new Error('Verification failed');
      }
    }

    return true;
  }

  /**
   * Program flash from a binary file
   * @param filePath Path to the binary file to write
   * @param address Starting address in flash (default: 0, requires file size to match flash size)
   * @param options Programming options (erase, verify, progress callback)
   */
  async programFile(
    filePath: string,
    address?: number,
    options: {
      erase?: boolean;
      verify?: boolean;
      onProgress?: FlashProgressCallback;
    } = {}
  ): Promise<boolean> {
    const data = await fs.readFile(filePath);

    // If no address specified, default to 0 but require file size to match flash size
    if (address === undefined) {
      if (!this.flashInfo?.size) {
        throw new Error('Flash size unknown. Call readJedecId() first or specify an address.');
      }
      if (data.length !== this.flashInfo.size) {
        throw new Error(
          `File size (${data.length} bytes) does not match flash size (${this.flashInfo.size} bytes). ` +
          `Specify an address explicitly to write partial data.`
        );
      }
      address = 0;
    }

    return this.program(address, data, options);
  }

  /**
   * Read flash contents and save to a binary file
   * @param filePath Path to save the binary file
   * @param address Starting address in flash (default: 0)
   * @param length Number of bytes to read (if not specified, reads entire flash based on JEDEC ID)
   * @param onProgress Progress callback
   */
  async readToFile(
    filePath: string,
    address = 0,
    length?: number,
    onProgress?: FlashProgressCallback
  ): Promise<void> {
    const readLength = length ?? this.flashInfo?.size;
    if (!readLength) {
      throw new Error('Length not specified and flash size unknown. Call readJedecId() first or specify length.');
    }

    const data = await this.read(address, readLength, onProgress);
    await fs.writeFile(filePath, data);
  }

  /**
   * Get flash info (call readJedecId first)
   */
  getFlashInfo(): FlashInfo | null {
    return this.flashInfo;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
