export type AvailabilitySlot = {
  date: string; // ISO date (yyyy-mm-dd)
  startTime: string; // HH:mm
  endTime: string; // HH:mm
};

export type ParticipantAvailability = {
  id: string;
  projectId: string;
  inviteeId?: string | null;
  authorInviteeId?: string | null;
  name: string;
  slots: AvailabilitySlot[];
  createdAt: string;
};

export type Project = {
  id: string;
  title: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  createdAt: string;
};

export type ProjectInvitee = {
  id: string;
  projectId: string;
  name: string;
  password?: string | null;
  createdAt: string;
};

export type DocumentNoteReply = {
  id: string;
  noteId: string;
  inviteeId?: string | null;
  authorInviteeId?: string | null;
  content: string;
  createdAt: string;
};

export type DocumentNote = {
  id: string;
  documentId: string;
  inviteeId?: string | null;
  authorInviteeId?: string | null;
  content: string;
  visibleTo?: string[] | null;
  allowReplies: boolean;
  parentNoteId?: string | null;
  version?: number;
  createdAt: string;
  replies: DocumentNoteReply[];
};

export type DocumentSignatureNote = DocumentNote;

export type ProjectActivityLog = {
  id: string;
  projectId: string;
  inviteeId?: string | null;
  authorInviteeId?: string | null;
  actorName?: string | null;
  action: string;
  details?: { summary: string; data?: Record<string, unknown> } | null;
  createdAt: string;
};

export type ProjectDocument = {
  id: string;
  projectId: string;
  filePath: string;
  fileType: string;
  totalPages?: number | null;
  currentVersion: number;
  uploadedBy?: string | null;
  sharedWithAll: boolean;
  createdAt: string;
  notes?: DocumentNote[];
};

export type DocumentPermission = {
  documentId: string;
  inviteeId: string;
  canView: boolean;
  canEdit: boolean;
  createdAt: string;
};

export type DocumentVersion = {
  id: string;
  documentId: string;
  version: number;
  mergedFilePath: string;
  createdAt: string;
};

export type DocumentSignature = {
  id: string;
  documentId: string;
  inviteeId: string;
  version: number;
  strokesJson?: unknown;
  typedText?: string | null;
  typedFont?: string | null;
  typedColor?: string | null;
  uploadedSignaturePath?: string | null;
  overlayImagePath?: string | null;
  signedAt?: string | null;
  createdAt: string;
};

export type ProjectDocumentWithRelations = ProjectDocument & {
  permissions: DocumentPermission[];
  versions: DocumentVersion[];
  signatures: DocumentSignature[];
  notes: DocumentNote[];
};



