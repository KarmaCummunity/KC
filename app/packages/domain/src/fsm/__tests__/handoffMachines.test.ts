import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal } from '../machine';
import { eventRegistrationMachine } from '../machines/eventRegistration';
import { givingHandoffMachine } from '../machines/givingHandoff';
import { handoffMachineFor } from '../machines/handoffMachineFor';
import { housingBookingMachine } from '../machines/housingBooking';
import { rideBookingMachine } from '../machines/rideBooking';

/** True when the move is a legal, state-changing edge of the machine. */
const legal = (machine: Parameters<typeof canTransition>[0], from: string, to: string) =>
  canTransition(machine, from, to).ok;

describe('handoffMachineFor', () => {
  it('picks the booking machine of rides, housing and events', () => {
    expect(handoffMachineFor('rides')).toBe(rideBookingMachine);
    expect(handoffMachineFor('housing')).toBe(housingBookingMachine);
    expect(handoffMachineFor('time')).toBe(eventRegistrationMachine);
  });

  it('uses the giving handoff for every other world, including unknown ones', () => {
    for (const world of ['items', 'food', 'animals', 'knowledge', 'a_future_world']) {
      expect(handoffMachineFor(world)).toBe(givingHandoffMachine);
    }
  });
});

describe('giving handoff', () => {
  it('settles a reservation directly when the post closes', () => {
    expect(legal(givingHandoffMachine, 'reserved', 'handed_over')).toBe(true);
  });

  it('marks a confirmed pickup a no-show, and nothing leaves the end states', () => {
    expect(legal(givingHandoffMachine, 'confirmed', 'no_show')).toBe(true);
    for (const end of ['handed_over', 'cancelled', 'no_show']) {
      expect(isTerminal(givingHandoffMachine, end)).toBe(true);
    }
  });

  it('has no waitlist', () => {
    expect(canTransition(givingHandoffMachine, 'waitlisted', 'reserved')).toEqual({
      ok: false,
      code: 'unknown_state',
    });
  });
});

describe('ride booking', () => {
  it('reinstates a declined or driver-cancelled booking', () => {
    expect(legal(rideBookingMachine, 'cancelled', 'reserved')).toBe(true);
    expect(legal(rideBookingMachine, 'cancelled', 'confirmed')).toBe(true);
  });

  it('has no no-show, and a completed trip is final', () => {
    expect(canTransition(rideBookingMachine, 'confirmed', 'no_show').ok).toBe(false);
    expect(isTerminal(rideBookingMachine, 'handed_over')).toBe(true);
  });
});

describe('housing booking', () => {
  it('completes or misses only an approved stay', () => {
    expect(legal(housingBookingMachine, 'confirmed', 'handed_over')).toBe(true);
    expect(legal(housingBookingMachine, 'confirmed', 'no_show')).toBe(true);
    expect(legal(housingBookingMachine, 'reserved', 'handed_over')).toBe(false);
  });
});

describe('event registration', () => {
  it('promotes from the waitlist to reserved or confirmed', () => {
    expect(legal(eventRegistrationMachine, 'waitlisted', 'reserved')).toBe(true);
    expect(legal(eventRegistrationMachine, 'waitlisted', 'confirmed')).toBe(true);
  });

  it('corrects an absence to attended, but not the other way', () => {
    expect(legal(eventRegistrationMachine, 'no_show', 'handed_over')).toBe(true);
    expect(legal(eventRegistrationMachine, 'handed_over', 'no_show')).toBe(false);
  });

  it('marks attendance only from a confirmed place', () => {
    expect(legal(eventRegistrationMachine, 'reserved', 'handed_over')).toBe(false);
    expect(legal(eventRegistrationMachine, 'waitlisted', 'no_show')).toBe(false);
  });
});

describe('same-status writes', () => {
  it('are legal no-ops in every handoff machine', () => {
    for (const machine of [givingHandoffMachine, rideBookingMachine, housingBookingMachine, eventRegistrationMachine]) {
      expect(canTransition(machine, 'cancelled', 'cancelled')).toEqual({ ok: true, changed: false });
    }
  });
});
