import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  CH347Device,
  LibUSBBackend,
  WCHBackend,
  CH347USB,
  CH347GPIO,
  CH347SPI,
  CH347Flash,
  SPISpeed,
} from './index';

describe('node-ch347', () => {
  describe('exports', () => {
    it('should export CH347Device class', () => {
      assert.strictEqual(typeof CH347Device, 'function');
    });

    it('should export backend classes', () => {
      assert.strictEqual(typeof LibUSBBackend, 'function');
      assert.strictEqual(typeof WCHBackend, 'function');
    });

    it('should export core module classes', () => {
      assert.strictEqual(typeof CH347USB, 'function');
      assert.strictEqual(typeof CH347GPIO, 'function');
      assert.strictEqual(typeof CH347SPI, 'function');
      assert.strictEqual(typeof CH347Flash, 'function');
    });
  });

  describe('CH347Device', () => {
    it('should create instance without options', () => {
      const device = new CH347Device();
      assert.ok(device instanceof CH347Device);
    });

    it('should create instance with options', () => {
      const device = new CH347Device({
        spi: { speed: SPISpeed.CLK_30M },
      });
      assert.ok(device instanceof CH347Device);
    });

    it('should report not connected before open', () => {
      const device = new CH347Device();
      assert.strictEqual(device.isConnected(), false);
    });

    it('should have static listDevices method', () => {
      assert.strictEqual(typeof CH347Device.listDevices, 'function');
    });

    it('should have static listDevicesWithSerial method', () => {
      assert.strictEqual(typeof CH347Device.listDevicesWithSerial, 'function');
    });
  });
});
