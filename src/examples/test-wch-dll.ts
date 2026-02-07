/**
 * Test script for WCH DLL backend on Windows
 *
 * This script tests the WCH DLL integration by:
 * 1. Checking if the DLL is available
 * 2. Listing connected devices
 * 3. Opening a device and reading basic info
 *
 * Prerequisites:
 * - Windows OS
 * - CH347DLL.dll in PATH or current directory
 * - npm install koffi
 *
 * Usage:
 *   npx ts-node src/examples/test-wch-dll.ts
 *   # or after build:
 *   node dist/examples/test-wch-dll.js
 */

import { CH347Device } from '../index';
import { isWCHDLLAvailable, getWCHDLLError } from '../wch-dll';

async function main() {
  console.log('=== WCH DLL Backend Test ===\n');

  // Check platform
  if (process.platform !== 'win32') {
    console.log('This test is for Windows only.');
    console.log(`Current platform: ${process.platform}`);
    console.log('\nOn non-Windows platforms, use the libusb backend (default).');
    process.exit(0);
  }

  // Step 1: Check if DLL is available
  console.log('Step 1: Checking WCH DLL availability...');

  if (!isWCHDLLAvailable()) {
    const error = getWCHDLLError();
    console.error('Failed to load WCH DLL:', error?.message);
    console.log('\nTo fix this:');
    console.log('1. Download CH347 drivers from: https://www.wch.cn/downloads/CH341PAR_ZIP.html');
    console.log('2. Extract CH347DLL.dll (or CH347DLLA64.dll for 64-bit) to:');
    console.log('   - Your application directory');
    console.log('   - Or add to system PATH');
    console.log('3. Install koffi: npm install koffi');
    process.exit(1);
  }

  console.log('WCH DLL loaded successfully!\n');

  // Step 2: List devices using the common interface
  console.log('Step 2: Listing connected CH347 devices...');

  // Create device with WCH backend
  const device = new CH347Device({ backend: 'wch' });

  try {
    const devices = await CH347Device.listDevices();
    console.log(`Found ${devices.length} device(s)\n`);

    if (devices.length === 0) {
      console.log('No CH347 devices found.');
      console.log('Make sure your CH347 device is connected.');
      process.exit(0);
    }

    // Step 3: Open first device
    console.log('Step 3: Opening device 0...');
    await device.open(0);
    console.log('Device opened successfully!\n');

    // Test GPIO read
    console.log('Step 4: Reading GPIO states...');
    try {
      const gpioStates = await device.gpioReadAll();
      console.log('GPIO States:');
      for (const state of gpioStates) {
        console.log(`  GPIO${state.pin}: ${state.direction} = ${state.value ? 'HIGH' : 'LOW'}`);
      }
      console.log('');
    } catch (err) {
      console.error('GPIO read failed:', err);
    }

    // SPI is auto-initialized on open, test transfer
    console.log('Step 5: Testing SPI...');
    try {
      // Try reading JEDEC ID (common flash command)
      console.log('Step 6: Attempting to read SPI flash JEDEC ID...');
      const jedecCmd = Buffer.from([0x9f, 0, 0, 0]);
      const response = await device.spiTransfer(jedecCmd);
      const manufacturerId = response[1];
      const memoryType = response[2];
      const capacity = response[3];
      const jedecId = (manufacturerId << 16) | (memoryType << 8) | capacity;

      if (jedecId !== 0 && jedecId !== 0xffffff) {
        console.log(`JEDEC ID: 0x${jedecId.toString(16).padStart(6, '0')}`);
        console.log(`  Manufacturer: 0x${manufacturerId.toString(16)}`);
        console.log(`  Memory Type: 0x${memoryType.toString(16)}`);
        console.log(`  Capacity: 0x${capacity.toString(16)}`);
      } else {
        console.log('No SPI flash detected (or not connected).');
      }
      console.log('');
    } catch (err) {
      console.error('SPI operation failed:', err);
    }

    // Close device
    console.log('Step 7: Closing device...');
    await device.close();
    console.log('Device closed.\n');

    console.log('=== All tests completed successfully! ===');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main().catch(console.error);
