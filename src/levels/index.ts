import type { WorldDef } from './types';
import meadow from './w1-meadow.json';
import springs from './w2-springs.json';
import lagoon from './w3-lagoon.json';
import workshop from './w4-workshop.json';
import gusts from './w5-gusts.json';

export const WORLDS: WorldDef[] = [meadow, springs, lagoon, workshop, gusts] as WorldDef[];
