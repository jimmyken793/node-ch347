/**
 * CH347 Serial Number Example
 *
 * List connected CH347 devices with their serial numbers.
 *
 * Usage:
 *   npx ts-node src/examples/serial-number.ts
 */

import CH347Device from '../index';

async function listDevices() {
  console.log('Scanning for CH347 devices...\n');

  const devices = await CH347Device.listDevicesWithSerial();

  if (devices.length === 0) {
    console.log('No CH347 devices found.');
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

listDevices().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
