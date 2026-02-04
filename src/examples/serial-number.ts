/**
 * CH347 Serial Number Example
 *
 * List connected CH347 devices with their serial numbers.
 * Cross-platform: Works on Linux, macOS, and Windows
 *
 * Note: On Windows with WCH backend, serial number info may not be available.
 *
 * Usage:
 *   npx ts-node src/examples/serial-number.ts
 */

import CH347Device, { isWCHDLLAvailable, CH347WCH } from '../index';

async function listDevices() {
  const isWindows = process.platform === 'win32';
  const useWCHBackend = isWindows && isWCHDLLAvailable();

  console.log('Scanning for CH347 devices...');
  console.log(`Platform: ${process.platform}`);
  if (isWindows) {
    console.log(`Backend: ${useWCHBackend ? 'WCH DLL' : 'libusb'}`);
  }
  console.log('');

  if (useWCHBackend) {
    // WCH backend - limited device info
    const devices = CH347WCH.listDevices();
    if (devices.length === 0) {
      console.log('No CH347 devices found.');
      return;
    }

    console.log(`Found ${devices.length} device(s):\n`);
    for (const index of devices) {
      console.log(`Device ${index}:`);
      console.log(`  Index: ${index}`);
      console.log(`  Serial Number: (not available with WCH backend)`);
      console.log('');
    }

    console.log('Note: Use Device Manager on Windows to view device serial numbers.');
  } else {
    // libusb backend - full device info
    const devices = await CH347Device.listDevicesWithSerial();

    if (devices.length === 0) {
      console.log('No CH347 devices found.');
      if (isWindows) {
        console.log('');
        console.log('Tip: Install koffi (npm install koffi) and CH347DLL.dll for WCH backend');
      }
      return;
    }

    console.log(`Found ${devices.length} device(s):\n`);

    for (const device of devices) {
      console.log(`Device ${device.index}:`);
      console.log(`  Bus: ${device.busNumber}, Address: ${device.deviceAddress}`);
      console.log(`  VID: 0x${device.vendorId.toString(16).padStart(4, '0')}`);
      console.log(`  PID: 0x${device.productId.toString(16).padStart(4, '0')}`);
      console.log(`  Manufacturer: ${device.manufacturer ?? '(not available)'}`);
      console.log(`  Product: ${device.product ?? '(not available)'}`);
      console.log(`  Serial Number: ${device.serialNumber ?? '(not available)'}`);
      console.log('');
    }
  }
}

listDevices().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
