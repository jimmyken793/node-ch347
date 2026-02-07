/**
 * Hardware tests - require a physical CH347 device connected
 *
 * Run with: npm run test:hardware
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

import { CH347Device } from './index';

describe('CH347 Hardware Tests', () => {
  let device: CH347Device;

  before(async () => {
    device = new CH347Device();
    await device.open();
  });

  after(() => {
    device.close();
  });

  describe('device connection', () => {
    it('should be connected after open', () => {
      assert.strictEqual(device.isConnected(), true);
    });

    it('should list at least one device', async () => {
      const devices = await CH347Device.listDevices();
      assert.ok(devices.length > 0, 'No CH347 devices found');
    });
  });

  describe('GPIO', () => {
    it('should read all GPIO states', async () => {
      const states = await device.gpioReadAll();
      assert.strictEqual(states.length, 8);
    });

    it('should toggle GPIO pin', async () => {
      const initialState = await device.gpioRead(0);
      const newValue = await device.gpioToggle(0);
      assert.strictEqual(newValue, !initialState.value);
      // Restore original state
      await device.gpioWrite(0, initialState.value);
    });
  });

  describe('SPI', () => {
    it('should initialize SPI', async () => {
      await device.spiInit();
      // If we get here without error, SPI initialized successfully
    });

    it('should read flash JEDEC ID', async () => {
      const flashInfo = await device.flashReadId();
      assert.ok(flashInfo.jedecId !== 0, 'Invalid JEDEC ID');
      assert.ok(flashInfo.size > 0, 'Invalid flash size');
    });
  });
});
