export {
  QUESTION_TYPES,
  NON_COMMITTAL_ANSWERS,
  optionSchema,
  durationBandSchema,
  questionSchema,
  type QuestionType,
  type NonCommittalAnswer,
  type Question,
} from './question';

export { conditionSchema, evaluate, type AnswerLookup, type Condition } from './branching';

export {
  nodeSchema,
  questionnaireSchema,
  nextQuestion,
  applicableQuestions,
  validateQuestionnaire,
  type Questionnaire,
  type QuestionnaireNode,
  type NextQuestion,
} from './questionnaire';

/** Identifies exactly which approved content version produced a stored answer. */
export interface QuestionnaireVersionRef {
  readonly questionnaireId: string;
  readonly version: string;
  readonly effectiveFrom: string;
}
