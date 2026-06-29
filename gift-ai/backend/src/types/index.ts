export type ConsultationStage =
  | 1 // occasion
  | 2 // recipient
  | 3 // timing & delivery
  | 4 // budget
  | 5 // emotional goal
  | 6 // interests & story
  | 7 // personality (internal)
  | 8 // recommendation
  | 9 // comparison
  | 10; // handoff to manager

export type PersonalityType =
  | "романтик"
  | "предприниматель"
  | "семьянин"
  | "путешественник"
  | "исследователь"
  | "творческий"
  | "руководитель"
  | "экстраверт"
  | "интроверт"
  | "";

export type LeadScoreBand = "ready" | "needs_details" | "interested" | "non_target";

export type QualificationFields = {
  clientName: string;
  phone: string;
  telegram: string;
  email: string;
  occasion: string;
  eventDate: string;
  recipient: string;
  recipientAge: string;
  recipientGender: string;
  relationship: string;
  city: string;
  country: string;
  needsDelivery: string;
  urgency: string;
  budget: string;
  desiredEmotions: string;
  interests: string;
  hobbies: string;
  story: string;
  personalityType: PersonalityType;
  recommendedGiftId: string;
  recommendedGiftName: string;
  alternatives: string;
  recommendationReason: string;
  comments: string;
};

export const EMPTY_QUALIFICATION: QualificationFields = {
  clientName: "",
  phone: "",
  telegram: "",
  email: "",
  occasion: "",
  eventDate: "",
  recipient: "",
  recipientAge: "",
  recipientGender: "",
  relationship: "",
  city: "",
  country: "",
  needsDelivery: "",
  urgency: "",
  budget: "",
  desiredEmotions: "",
  interests: "",
  hobbies: "",
  story: "",
  personalityType: "",
  recommendedGiftId: "",
  recommendedGiftName: "",
  alternatives: "",
  recommendationReason: "",
  comments: "",
};

export type SheetGiftRow = {
  externalId: string;
  name: string;
  description: string;
  priceMin: number;
  priceMax: number;
  emotions: string[];
  suitableFor: string[];
  occasions: string[];
  leadTimeDays: number;
  personalization: string;
  photoUrl: string;
  cases: string;
  reviews: string;
  active: boolean;
};

export type Gift = {
  id: string;
  externalId: string;
  name: string;
  description: string;
  priceMin: number;
  priceMax: number;
  emotions: string[];
  suitableFor: string[];
  occasions: string[];
  leadTimeDays: number;
  personalization: string;
  photoUrl: string;
  cases: string;
  reviews: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MessageRole = "user" | "assistant" | "system";

export type ConversationMessage = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
};

export type Conversation = {
  id: string;
  channel: string;
  channelUserId: string;
  stage: ConsultationStage;
  fields: QualificationFields;
  leadScore: number;
  leadScoreBand: LeadScoreBand;
  status: "active" | "completed" | "abandoned";
  summary: string;
  bitrixLeadId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LeadPayload = QualificationFields & {
  conversationId: string;
  channel: string;
  channelUserId: string;
  leadScore: number;
  leadScoreBand: LeadScoreBand;
  fullTranscript: string;
  aiSummary: string;
  recommendedGiftId: string;
};

export type EngineResponse = {
  reply: string;
  stage: ConsultationStage;
  fields: Partial<QualificationFields>;
  personalityType: PersonalityType;
  leadScore: number;
  leadScoreBand: LeadScoreBand;
  recommendedGiftIds: string[];
  emotion: string;
  isComplete: boolean;
};

export type EmotionAnalysis = {
  tone: "positive" | "neutral" | "hesitant" | "negative" | "urgent";
  confidence: number;
  hints: string[];
};
