import type {
  ClassifiedAction,
  ClientState,
  EvaluationResult,
  TrainingScenario,
} from "../training/types.js";

export interface GenerateClientReplyOpts {
  scenario: TrainingScenario;
  history: Array<{ author: string; text: string }>;
  clientState: ClientState;
  lastManagerAction: ClassifiedAction | null;
  revealedFacts: string[];
}

export interface GenerateManagerReplyOpts {
  scenario: TrainingScenario;
  history: Array<{ author: string; text: string }>;
  clientState: ClientState;
}

export interface ClassifyManagerActionOpts {
  managerText: string;
  history: Array<{ author: string; text: string }>;
  clientState: ClientState;
  scenario: TrainingScenario;
}

export interface EvaluateSessionOpts {
  scenario: TrainingScenario;
  history: Array<{ author: string; text: string }>;
  stateHistory: Array<{ turn: number; state: ClientState }>;
  finalState: ClientState;
  hintsUsed: number;
}

export interface GenerateScenarioOpts {
  sourceDialogue: string;
  difficulty?: string;
  skill?: string;
}

export interface GenerateHintOpts {
  scenario: TrainingScenario;
  history: Array<{ author: string; text: string }>;
  clientState: ClientState;
  revealedFacts: string[];
}

export interface HintResult {
  currentStage: string;
  knownFacts: string[];
  unknownFacts: string[];
  suggestion: string;
  clientMoodLabel: string;
}

export interface LLMProvider {
  generateClientReply(opts: GenerateClientReplyOpts): Promise<string>;
  generateManagerReply(opts: GenerateManagerReplyOpts): Promise<string>;
  classifyManagerAction(opts: ClassifyManagerActionOpts): Promise<ClassifiedAction>;
  evaluateSession(opts: EvaluateSessionOpts): Promise<EvaluationResult>;
  generateScenario(opts: GenerateScenarioOpts): Promise<Partial<TrainingScenario>>;
  generateHint(opts: GenerateHintOpts): Promise<HintResult>;
}
