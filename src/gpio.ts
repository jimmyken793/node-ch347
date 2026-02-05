/**
 * CH347 GPIO Control
 *
 * Protocol from ch347-gpio.c:
 * - GPIO buffer is 11 bytes: [0xCC, length(8), 0x00, pin0, pin1, pin2, pin3, pin4, pin5, pin6, pin7]
 * - Each pin byte has control bits:
 *   - Bit 7 (0x80): In response, indicates output direction
 *   - Bit 6 (0x40): Enable pin change (out) / Current value (in)
 *   - Bit 5-4 (0x30): Set direction to output
 *   - Bit 3 (0x08): Set pin value high
 */

import { CH347USB } from './usb';
import {
  CH347_CMD_GPIO,
  CH347_GPIO_COUNT,
  GPIO_PIN_ENABLE,
  GPIO_PIN_DIR_OUT,
  GPIO_PIN_VALUE_HIGH,
  GPIO_PIN_IS_OUTPUT,
  GPIO_PIN_VALUE,
  delay,
} from './constants';
import { GPIOConfig, GPIOState } from './types';

export class CH347GPIO {
  private usb: CH347USB;
  private pinStates: GPIOState[] = [];

  constructor(usb: CH347USB) {
    this.usb = usb;

    // Initialize pin states
    for (let i = 0; i < CH347_GPIO_COUNT; i++) {
      this.pinStates[i] = {
        pin: i,
        direction: 'input',
        value: false,
      };
    }
  }

  /**
   * Build GPIO command buffer
   */
  private buildCommandBuffer(pinConfigs: Map<number, { setDir?: boolean; dirOut?: boolean; setValue?: boolean; value?: boolean }>): Buffer {
    const buf = Buffer.alloc(11);
    buf[0] = CH347_CMD_GPIO;
    buf[1] = 8; // Length of pin data
    buf[2] = 0;

    // Set pin bytes
    for (const [pin, config] of pinConfigs) {
      if (pin >= 0 && pin < CH347_GPIO_COUNT) {
        let pinByte = 0;

        if (config.setDir || config.setValue) {
          pinByte |= GPIO_PIN_ENABLE; // Enable change (0xC0)
        }

        if (config.setDir && config.dirOut) {
          pinByte |= GPIO_PIN_DIR_OUT; // Set output direction (0x30)
        }

        if (config.setValue && config.value) {
          pinByte |= GPIO_PIN_VALUE_HIGH; // Set value high (0x08)
        }

        buf[3 + pin] = pinByte;
      }
    }

    return buf;
  }

  /**
   * Parse GPIO response buffer
   */
  private parseResponse(buf: Buffer): GPIOState[] {
    const states: GPIOState[] = [];

    for (let i = 0; i < CH347_GPIO_COUNT; i++) {
      const pinByte = buf[3 + i];
      states.push({
        pin: i,
        direction: (pinByte & GPIO_PIN_IS_OUTPUT) ? 'output' : 'input',
        value: (pinByte & GPIO_PIN_VALUE) !== 0,
      });
    }

    return states;
  }

  /**
   * Read all GPIO states
   */
  async readAll(): Promise<GPIOState[]> {
    // Send read command (empty pin config)
    const cmdBuf = this.buildCommandBuffer(new Map());
    const response = await this.usb.transfer(cmdBuf, 11);

    this.pinStates = this.parseResponse(response);
    return this.pinStates;
  }

  /**
   * Read single GPIO pin state
   */
  async read(pin: number): Promise<GPIOState> {
    if (pin < 0 || pin >= CH347_GPIO_COUNT) {
      throw new Error(`Invalid pin number: ${pin}`);
    }

    const states = await this.readAll();
    return states[pin];
  }

  /**
   * Configure GPIO pin direction
   */
  async setDirection(pin: number, direction: 'input' | 'output'): Promise<void> {
    if (pin < 0 || pin >= CH347_GPIO_COUNT) {
      throw new Error(`Invalid pin number: ${pin}`);
    }

    const pinConfig = new Map<number, { setDir: boolean; dirOut: boolean; setValue: boolean; value: boolean }>();
    pinConfig.set(pin, {
      setDir: true,
      dirOut: direction === 'output',
      setValue: true,
      value: this.pinStates[pin]?.value ?? false,
    });

    const cmdBuf = this.buildCommandBuffer(pinConfig);
    const response = await this.usb.transfer(cmdBuf, 11);
    this.pinStates = this.parseResponse(response);
  }

  /**
   * Set GPIO output value
   */
  async write(pin: number, value: boolean): Promise<void> {
    if (pin < 0 || pin >= CH347_GPIO_COUNT) {
      throw new Error(`Invalid pin number: ${pin}`);
    }

    // First ensure pin is set as output
    const pinConfig = new Map<number, { setDir: boolean; dirOut: boolean; setValue: boolean; value: boolean }>();
    pinConfig.set(pin, {
      setDir: true,
      dirOut: true,
      setValue: true,
      value: value,
    });

    const cmdBuf = this.buildCommandBuffer(pinConfig);
    const response = await this.usb.transfer(cmdBuf, 11);
    this.pinStates = this.parseResponse(response);
  }

  /**
   * Set multiple GPIO pins at once
   */
  async writeMultiple(pins: { pin: number; value: boolean }[]): Promise<void> {
    const pinConfig = new Map<number, { setDir: boolean; dirOut: boolean; setValue: boolean; value: boolean }>();

    for (const { pin, value } of pins) {
      if (pin < 0 || pin >= CH347_GPIO_COUNT) {
        throw new Error(`Invalid pin number: ${pin}`);
      }
      pinConfig.set(pin, {
        setDir: true,
        dirOut: true,
        setValue: true,
        value: value,
      });
    }

    const cmdBuf = this.buildCommandBuffer(pinConfig);
    const response = await this.usb.transfer(cmdBuf, 11);
    this.pinStates = this.parseResponse(response);
  }

  /**
   * Configure multiple GPIO pins
   */
  async configure(configs: GPIOConfig[]): Promise<void> {
    const pinConfig = new Map<number, { setDir: boolean; dirOut: boolean; setValue: boolean; value: boolean }>();

    for (const config of configs) {
      if (config.pin < 0 || config.pin >= CH347_GPIO_COUNT) {
        throw new Error(`Invalid pin number: ${config.pin}`);
      }
      pinConfig.set(config.pin, {
        setDir: true,
        dirOut: config.direction === 'output',
        setValue: config.value !== undefined,
        value: config.value ?? false,
      });
    }

    const cmdBuf = this.buildCommandBuffer(pinConfig);
    const response = await this.usb.transfer(cmdBuf, 11);
    this.pinStates = this.parseResponse(response);
  }

  /**
   * Pulse a GPIO pin (useful for buttons)
   */
  async pulse(pin: number, durationMs: number = 100, activeHigh: boolean = true): Promise<void> {
    await this.write(pin, activeHigh);
    await delay(durationMs);
    await this.write(pin, !activeHigh);
  }

  /**
   * Toggle GPIO pin
   */
  async toggle(pin: number): Promise<boolean> {
    const state = await this.read(pin);
    const newValue = !state.value;
    await this.write(pin, newValue);
    return newValue;
  }

  /**
   * Get cached pin states (call readAll() to refresh)
   */
  getPinStates(): GPIOState[] {
    return [...this.pinStates];
  }
}
