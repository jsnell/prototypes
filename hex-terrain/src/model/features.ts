export type FeatureId = 'village' | 'town' | 'castle' | 'tower' | 'farm' | 'ruins' | 'mine';

export interface FeatureInfo {
  id: FeatureId;
  name: string;
  /** Short description for UI tooltips. */
  hint: string;
}

export const FEATURES: Record<FeatureId, FeatureInfo> = {
  village: { id: 'village', name: 'Village', hint: 'A cluster of houses that lines up along roads and gets a pier on the water.' },
  town: { id: 'town', name: 'Town', hint: 'A walled town with a central hall. Roads get gates.' },
  castle: { id: 'castle', name: 'Castle', hint: 'A keep with curtain walls and corner towers.' },
  tower: { id: 'tower', name: 'Watchtower', hint: 'A lone lookout tower.' },
  farm: { id: 'farm', name: 'Farmstead', hint: 'Fields in the local style: wheat, paddies, or irrigated plots.' },
  ruins: { id: 'ruins', name: 'Ruins', hint: 'Broken walls reclaimed by the land.' },
  mine: { id: 'mine', name: 'Mine', hint: 'A shaft in the hillside, or a quarry in open ground.' },
};

export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];
