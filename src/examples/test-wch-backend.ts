/**
 * Test script for CH347Device with WCH DLL backend
 *
 * This script demonstrates using the unified CH347Device API
 * with the WCH DLL backend on Windows.
 *
 * Prerequisites:
 * - Windows OS
 * - CH347DLL.dll in PATH or current directory
 * - npm install koffi
 *
 * Usage:
 *   npx ts-node src/examples/test-wch-backend.ts
 *   # or after build:
 *   node dist/examples/test-wch-backend.js
 */

import CH347Device, { setWindowsBackend, SPISpeed, isWCHDLLAvailable } from '../index';

async function main() {
  console.log('=== CH347Device with WCH Backend Test ===\n');

  // Check platform
  if (process.platform !== 'win32') {
    console.log('This test is for Windows only.');
    console.log(`Current platform: ${process.platform}`);
    process.exit(0);
  }

  // Check DLL availability
  if (!isWCHDLLAvailable()) {
    console.error('WCH DLL not available.');
    console.log('Download from: https://www.wch.cn/downloads/CH341PAR_ZIP.html');
    process.exit(1);
  }

  console.log('WCH DLL is available.\n');

  // Set WCH backend globally
  setWindowsBackend('wch');
  console.log('Backend set to: wch\n');

  // Create device with WCH backend
  const device = new CH347Device({
    spi: { speed: SPISpeed.CLK_15M }
  });

  console.log('Device created.\n');

  try {
    // Open device
    console.log('Opening device...');
    await device.open(0);
    console.log(`Device opened. Using WCH backend: ${device.isUsingWCHBackend()}\n`);

    // Read GPIO states
    console.log('Reading GPIO states...');
    const gpioStates = await device.gpioReadAll();
    for (const state of gpioStates) {
      console.log(`  GPIO${state.pin}: ${state.direction} = ${state.value ? 'HIGH' : 'LOW'}`);
    }
    console.log('');

    // Read flash ID
    console.log('Reading flash JEDEC ID...');
    try {
      const flashInfo = await device.flashReadId();
      console.log(`  Name: ${flashInfo.name ?? 'Unknown'}`);
      console.log(`  JEDEC ID: 0x${flashInfo.jedecId.toString(16)}`);
      console.log(`  Size: ${flashInfo.size} bytes (${flashInfo.size / 1024 / 1024} MB)`);
    } catch (err) {
      console.log('  No flash detected or error reading flash.');
    }
    console.log('');

    // Test GPIO write
    console.log('Testing GPIO write (pin 0 = HIGH)...');
    await device.gpioWrite(0, true);
    const state = await device.gpioRead(0);
    console.log(`  GPIO0 is now: ${state.value ? 'HIGH' : 'LOW'}\n`);

    // Close device
    console.log('Closing device...');
    device.close();
    console.log('Device closed.\n');

    console.log('=== Test completed successfully! ===');
  } catch (err) {
    console.error('Error:', err);
    device.close();
    process.exit(1);
  }
}

main().catch(console.error);
