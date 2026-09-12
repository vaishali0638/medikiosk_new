import { InvalidStateTransitionError, StateMachine } from './state-machine';

type Light = 'RED' | 'GREEN' | 'OFF';

const light = new StateMachine<Light>('Light', 'RED', {
  RED: ['GREEN', 'OFF'],
  GREEN: ['RED', 'OFF'],
  OFF: [],
});

describe('StateMachine', () => {
  it('permits a declared transition', () => {
    expect(light.canTransition('RED', 'GREEN')).toBe(true);
    expect(() => light.assertTransition('RED', 'GREEN')).not.toThrow();
  });

  it('rejects an undeclared transition', () => {
    expect(light.canTransition('OFF', 'GREEN')).toBe(false);
    expect(() => light.assertTransition('OFF', 'GREEN')).toThrow(InvalidStateTransitionError);
  });

  it('rejects a self-transition unless it is declared', () => {
    expect(light.canTransition('RED', 'RED')).toBe(false);
  });

  it('carries the machine name and both states on the error, for auditing', () => {
    try {
      light.assertTransition('OFF', 'GREEN');
      throw new Error('expected a throw');
    } catch (error) {
      const err = error as InvalidStateTransitionError;
      expect(err.machine).toBe('Light');
      expect(err.from).toBe('OFF');
      expect(err.to).toBe('GREEN');
      expect(err.code).toBe('INVALID_STATE_TRANSITION');
    }
  });

  it('identifies terminal states', () => {
    expect(light.isTerminal('OFF')).toBe(true);
    expect(light.isTerminal('RED')).toBe(false);
  });

  it('computes reachability from the initial state', () => {
    expect([...light.reachableStates()].sort()).toEqual(['GREEN', 'OFF', 'RED']);
  });
});
