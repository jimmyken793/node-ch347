#!/usr/bin/env node
/**
 * SPI Flash Programming Tool
 *
 * Cross-platform: Works on Linux, macOS, and Windows
 *
 * Usage: npx ts-node src/examples/flash-spi.ts <firmware.bin>
 *    or: node dist/examples/flash-spi.js <firmware.bin>
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  CH347Device,
  SPISpeed,
  FlashManufacturers,
  isWCHDLLAvailable,
  CH347WCH,
} from '../index';

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('SPI Flash Programming Tool');
    console.log('');
    console.log('Usage: flash-spi <firmware.bin>');
    console.log('');
    console.log('Options:');
    console.log('  <firmware.bin>  Binary file to flash');
    process.exit(1);
  }

  const firmwarePath = args[0];

  // Validate file exists
  if (!fs.existsSync(firmwarePath)) {
    console.error(`Error: File not found: ${firmwarePath}`);
    process.exit(1);
  }

  const fileSize = fs.statSync(firmwarePath).size;
  console.log(`File: ${path.basename(firmwarePath)} (${fileSize} bytes)`);

  // Determine backend
  const isWindows = process.platform === 'win32';
  const useWCHBackend = isWindows && isWCHDLLAvailable();

  if (isWindows) {
    console.log(`Backend: ${useWCHBackend ? 'WCH DLL' : 'libusb'}`);
  }

  // Check for devices
  let deviceCount = 0;
  if (useWCHBackend) {
    deviceCount = CH347WCH.listDevices().length;
  } else {
    deviceCount = CH347Device.listDevices().length;
  }

  if (deviceCount === 0) {
    console.error('Error: No CH347 devices found!');
    if (isWindows && !useWCHBackend) {
      console.log('Tip: Install koffi (npm install koffi) and CH347DLL.dll for WCH backend');
    }
    process.exit(1);
  }

  // Create device instance with appropriate backend
  const device = new CH347Device({
    spi: {
      speed: SPISpeed.CLK_15M,
      mode: 0,
      chipSelect: 0,
      bitOrder: 'MSB',
    },
    backend: useWCHBackend ? 'wch' : 'auto',
  });

  try {
    // Open device
    console.log('Opening CH347 device...');
    await device.open(0);

    // Initialize SPI
    await device.spiInit({
      speed: SPISpeed.CLK_60M,
    });

    // Identify flash chip
    console.log('');
    console.log('--- Flash Chip ---');
    const flashInfo = await device.flashReadId();

    const manufacturerName = FlashManufacturers[flashInfo.manufacturerId] || 'Unknown';
    console.log(`Chip: ${flashInfo.name || 'Unknown'}`);
    console.log(`Manufacturer: ${manufacturerName}`);
    console.log(`JEDEC ID: 0x${flashInfo.jedecId.toString(16).padStart(6, '0')}`);
    console.log(`Size: ${flashInfo.size / 1024 / 1024} MB (${flashInfo.size} bytes)`);

    // Validate file size
    if (fileSize > flashInfo.size) {
      console.error(`Error: File size (${fileSize}) exceeds flash size (${flashInfo.size})`);
      process.exit(1);
    }

    // Program flash
    console.log('');
    console.log('--- Programming ---');
    console.log(`Writing ${fileSize} bytes to address 0x00000000...`);

    // Program flash
    console.log('Programming flash (erase + write + verify)...');
    const startTime = Date.now();

    const success = await device.flashProgramFile(firmwarePath, 0, {
      erase: true,
      verify: true,
      onProgress: (p) => {
        const op = p.operation.charAt(0).toUpperCase() + p.operation.slice(1);
        process.stdout.write(`\r${op}: ${p.percentage.toString().padStart(3)}%   `);
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('');

    if (success) {
      console.log(`\nSuccess! Programmed and verified in ${elapsed}s`);
    } else {
      console.error('\nError: Programming or verification failed!');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    device.close();
  }

  process.exit(0);
}

main();
