/**
 * CH347 Interactive GPIO Test
 *
 * Toggle GPIO pins interactively via command line
 * Cross-platform: Works on Linux, macOS, and Windows
 */

import * as readline from 'readline';
import CH347Device, { isWCHDLLAvailable } from '../index';

const GPIO_NAMES: Record<number, string> = {
  0: 'GPIO0',
  1: 'GPIO1',
  2: 'GPIO2',
  3: 'GPIO3',
  4: 'GPIO4',
  5: 'GPIO5',
  6: 'GPIO6',
  7: 'GPIO7',
};

let ch347: CH347Device;

async function printStatus() {
  const states = await ch347.gpioReadAll();
  console.log('\n--- GPIO Status ---');
  states.forEach((state) => {
    const name = GPIO_NAMES[state.pin] || `GPIO${state.pin}`;
    const dir = state.direction === 'output' ? 'OUT' : 'IN ';
    const val = state.value ? 'HIGH' : 'LOW ';
    console.log(`  ${state.pin}: ${dir} ${val}  ${name}`);
  });
  console.log('');
}

async function main() {
  const isWindows = process.platform === 'win32';
  const useWCHBackend = isWindows && isWCHDLLAvailable();

  console.log('CH347 Interactive GPIO Test');
  console.log(`Platform: ${process.platform}`);
  if (isWindows) {
    console.log(`Backend: ${useWCHBackend ? 'WCH DLL' : 'libusb'}`);
  }
  console.log('');

  // Find devices
  const deviceCount = (await CH347Device.listDevices()).length;

  if (deviceCount === 0) {
    console.log('No CH347 devices found!');
    if (isWindows && !useWCHBackend) {
      console.log('Tip: Install koffi (npm install koffi) and CH347DLL.dll for WCH backend');
    }
    return;
  }

  ch347 = new CH347Device({
    backend: useWCHBackend ? 'wch' : 'auto',
  });
  await ch347.open(0);
  console.log('Device opened!\n');

  // Configure GPIO 4-7 as outputs, default LOW
  console.log('Configuring GPIO 4-7 as outputs (LOW)...');
  for (let pin = 4; pin <= 7; pin++) {
    await ch347.gpioWrite(pin, false);
  }
  console.log('Done.\n');

  // Print initial status
  await printStatus();

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('Commands:');
  console.log('  s        - Show GPIO status');
  console.log('  h <pin>  - Set pin HIGH (e.g., "h 3")');
  console.log('  l <pin>  - Set pin LOW (e.g., "l 3")');
  console.log('  t <pin>  - Toggle pin (e.g., "t 3")');
  console.log('  p <pin>  - Pulse pin 100ms (e.g., "p 0")');
  console.log('  q        - Quit');
  console.log('');

  const prompt = () => {
    rl.question('gpio> ', async (input) => {
      const parts = input.trim().toLowerCase().split(/\s+/);
      const cmd = parts[0];
      const pin = parseInt(parts[1], 10);

      try {
        switch (cmd) {
          case 's':
          case 'status':
            await printStatus();
            break;

          case 'h':
          case 'high':
            if (isNaN(pin) || pin < 0 || pin > 7) {
              console.log('Usage: h <pin> (0-7)');
            } else {
              await ch347.gpioWrite(pin, true);
              console.log(`GPIO${pin} -> HIGH`);
            }
            break;

          case 'l':
          case 'low':
            if (isNaN(pin) || pin < 0 || pin > 7) {
              console.log('Usage: l <pin> (0-7)');
            } else {
              await ch347.gpioWrite(pin, false);
              console.log(`GPIO${pin} -> LOW`);
            }
            break;

          case 't':
          case 'toggle':
            if (isNaN(pin) || pin < 0 || pin > 7) {
              console.log('Usage: t <pin> (0-7)');
            } else {
              const states = await ch347.gpioReadAll();
              const current = states[pin]?.value ?? false;
              await ch347.gpioWrite(pin, !current);
              console.log(`GPIO${pin} -> ${!current ? 'HIGH' : 'LOW'}`);
            }
            break;

          case 'p':
          case 'pulse':
            if (isNaN(pin) || pin < 0 || pin > 7) {
              console.log('Usage: p <pin> (0-7)');
            } else {
              console.log(`Pulsing GPIO${pin} for 100ms...`);
              await ch347.gpioPulse(pin, 100);
              console.log(`GPIO${pin} pulse complete`);
            }
            break;

          case 'q':
          case 'quit':
          case 'exit':
            console.log('Closing device...');
            await ch347.close();
            rl.close();
            process.exit(0);
            return;

          case '':
            break;

          default:
            console.log('Unknown command. Use s/h/l/t/p/q');
        }
      } catch (err) {
        console.error('Error:', (err as Error).message);
      }

      prompt();
    });
  };

  prompt();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
