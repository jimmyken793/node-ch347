/**
 * CH347 Basic Example
 *
 * Demonstrates GPIO and SPI flash functionality
 * Cross-platform: Works on Linux, macOS, and Windows
 */

import CH347Device, {
  SPISpeed,
  SPIMode,
  isWCHDLLAvailable,
  CH347WCH,
} from '../index';

async function main() {
  const isWindows = process.platform === 'win32';

  // On Windows, prefer WCH DLL backend if available
  const useWCHBackend = isWindows && isWCHDLLAvailable();

  console.log('=== CH347 Basic Example ===');
  console.log(`Platform: ${process.platform}`);
  if (isWindows) {
    console.log(`Backend: ${useWCHBackend ? 'WCH DLL' : 'libusb'}`);
  }
  console.log('');

  // List available devices
  console.log('Scanning for CH347 devices...');

  let deviceCount = 0;
  if (useWCHBackend) {
    // Use WCH DLL to list devices
    const devices = CH347WCH.listDevices();
    deviceCount = devices.length;
    if (devices.length > 0) {
      console.log(`Found ${devices.length} device(s): indices ${devices.join(', ')}`);
    }
  } else {
    // Use libusb to list devices
    const devices = CH347Device.listDevices();
    deviceCount = devices.length;
    if (devices.length > 0) {
      console.log(`Found ${devices.length} device(s):`);
      devices.forEach((dev, i) => {
        console.log(`  [${i}] VID:${dev.vendorId.toString(16)} PID:${dev.productId.toString(16)} ${dev.product || ''}`);
      });
    }
  }

  if (deviceCount === 0) {
    console.log('No CH347 devices found!');
    console.log('Make sure:');
    console.log('  1. CH347 is connected via USB');
    if (isWindows) {
      console.log('  2. CH347 driver is installed (WCH driver or WinUSB via Zadig)');
      if (!useWCHBackend) {
        console.log('  3. For WCH backend: install koffi (npm install koffi) and CH347DLL.dll');
      }
    } else {
      console.log('  2. You have appropriate permissions (udev rules on Linux)');
    }
    return;
  }

  // Create device instance with appropriate backend
  const ch347 = new CH347Device({
    spi: {
      speed: SPISpeed.CLK_15M,
      mode: SPIMode.MODE_0,
    },
    backend: useWCHBackend ? 'wch' : 'auto',
  });

  try {
    // Open device
    console.log('\nOpening device...');
    await ch347.open(0);
    console.log('Device opened successfully!');

    // ==================== GPIO Demo ====================
    console.log('\n=== GPIO Demo ===');

    // Read all GPIO states
    console.log('Reading GPIO states...');
    const gpioStates = await ch347.gpioReadAll();
    gpioStates.forEach((state) => {
      console.log(`  GPIO${state.pin}: ${state.direction} = ${state.value ? 'HIGH' : 'LOW'}`);
    });

    // Set GPIO outputs (for your specific use case)
    console.log('\nConfiguring GPIO outputs...');

    // Power enable (GPIO 3) - start with power off
    await ch347.gpioWrite(3, false);
    console.log('  Power enable: OFF');

    // Programmer enable (GPIO 2) - enable programmer
    await ch347.gpioWrite(2, true);
    console.log('  Programmer enable: ON');

    // Small delay
    await delay(100);

    // Power enable - turn on
    await ch347.gpioWrite(3, true);
    console.log('  Power enable: ON');

    // ==================== SPI Flash Demo ====================
    console.log('\n=== SPI Flash Demo ===');

    // Initialize SPI
    console.log('Initializing SPI...');
    await ch347.spiInit();

    // Read flash ID
    console.log('Reading flash JEDEC ID...');
    try {
      const flashInfo = await ch347.flashReadId();
      console.log(`  Manufacturer: 0x${flashInfo.manufacturerId.toString(16)}`);
      console.log(`  Memory Type: 0x${flashInfo.memoryType.toString(16)}`);
      console.log(`  Capacity: 0x${flashInfo.capacity.toString(16)}`);
      console.log(`  JEDEC ID: 0x${flashInfo.jedecId.toString(16)}`);
      if (flashInfo.name) {
        console.log(`  Name: ${flashInfo.name}`);
      }
      if (flashInfo.size) {
        console.log(`  Size: ${flashInfo.size / 1024 / 1024} MB`);
      }

      // Read first 256 bytes
      console.log('\nReading first 256 bytes of flash...');
      const data = await ch347.flashRead(0, 256);
      console.log('  First 16 bytes:', data.subarray(0, 16).toString('hex'));

    } catch (err) {
      console.log('  No flash chip detected or error reading:', (err as Error).message);
    }

    // ==================== UART Path Discovery ====================
    console.log('\n=== UART Path Discovery ===');

    // Get UART path for this device (use external serial library for actual communication)
    const uartPath = ch347.getUARTPath();
    if (uartPath) {
      console.log(`UART path for this device: ${uartPath}`);
      console.log('  Use a serial library like serialport to communicate via this path');
    } else {
      if (useWCHBackend) {
        console.log('  UART path discovery not available with WCH backend');
        console.log('  Use Windows Device Manager to find COM port');
      } else {
        console.log('  Could not determine UART path');
      }
    }

    // ==================== Cleanup ====================
    console.log('\n=== Cleanup ===');

    // Turn off power
    await ch347.gpioWrite(3, false);
    console.log('Power disabled');

    // Close device
    ch347.close();
    console.log('Device closed');

  } catch (error) {
    console.error('Error:', error);
    ch347.close();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the example
main().catch(console.error);
