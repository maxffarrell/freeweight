// Inkless API integration for digital signature capture
// Documentation: https://useinkless.com/docs
import { env } from '$env/dynamic/private';

const INKLESS_API_BASE = 'https://api.useinkless.com/v1';
const INKLESS_API_KEY = env.INKLESS_API_KEY || '';

export interface InklessDocument {
  id: string;
  title: string;
  content: string;
  status: 'draft' | 'sent' | 'signed' | 'completed';
  created_at: string;
  signed_at?: string;
  signature_url?: string;
  signer: {
    name: string;
    email: string;
  };
}

export interface CreateDocumentRequest {
  title: string;
  content: string;
  signer: {
    name: string;
    email: string;
  };
  redirect_url?: string;
  webhook_url?: string;
}

class InklessAPI {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const response = await fetch(`${INKLESS_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Inkless API request failed');
    }

    return response.json();
  }

  async createDocument(data: CreateDocumentRequest): Promise<InklessDocument> {
    return this.request('/documents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getDocument(documentId: string): Promise<InklessDocument> {
    return this.request(`/documents/${documentId}`);
  }

  async sendForSignature(documentId: string): Promise<{ signing_url: string }> {
    return this.request(`/documents/${documentId}/send`, {
      method: 'POST',
    });
  }

  async getSigningUrl(documentId: string): Promise<{ signing_url: string }> {
    return this.request(`/documents/${documentId}/signing-url`);
  }

  async downloadDocument(documentId: string): Promise<Blob> {
    const response = await fetch(`${INKLESS_API_BASE}/documents/${documentId}/download`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to download document');
    }

    return response.blob();
  }
}

export const inklessAPI = new InklessAPI(INKLESS_API_KEY);

// Default liability waiver template
export const DEFAULT_LIABILITY_WAIVER = `
<h1>GYM LIABILITY WAIVER AND RELEASE AGREEMENT</h1>

<p><strong>Participant Name:</strong> {{PARTICIPANT_NAME}}</p>
<p><strong>Date:</strong> {{DATE}}</p>
<p><strong>Gym:</strong> {{GYM_NAME}}</p>

<h2>ASSUMPTION OF RISK AND WAIVER OF LIABILITY</h2>

<p>I, {{PARTICIPANT_NAME}}, acknowledge that participation in fitness activities and use of gym facilities involves inherent risks, including but not limited to:</p>

<ul>
  <li>Risk of injury from exercise equipment, weights, and other gym apparatus</li>
  <li>Risk of injury from participation in fitness classes and activities</li>
  <li>Risk of injury from interaction with other gym members</li>
  <li>Risk of cardiovascular complications</li>
  <li>Risk of muscle strains, sprains, and other physical injuries</li>
</ul>

<h2>RELEASE AND WAIVER</h2>

<p>In consideration for being allowed to participate in activities and use the facilities at {{GYM_NAME}}, I hereby:</p>

<ol>
  <li><strong>WAIVE, RELEASE, AND DISCHARGE</strong> {{GYM_NAME}}, its owners, employees, instructors, and agents from any and all liability, claims, demands, or causes of action arising from my use of the facilities or participation in activities.</li>
  
  <li><strong>ASSUME ALL RISKS</strong> associated with my participation, including but not limited to falls, contact with other participants, equipment failure, and negligence of other persons.</li>
  
  <li><strong>AGREE TO INDEMNIFY</strong> {{GYM_NAME}} against any claims made by others as a result of my actions while using the facilities.</li>
</ol>

<h2>MEDICAL CONDITION AND FITNESS</h2>

<p>I certify that:</p>
<ul>
  <li>I am in good physical condition and have no medical conditions that would prevent my participation</li>
  <li>I have consulted with a physician regarding my ability to participate in physical activities</li>
  <li>I will immediately notify gym staff of any injuries or medical issues</li>
</ul>

<h2>RULES AND REGULATIONS</h2>

<p>I agree to follow all posted rules and regulations of {{GYM_NAME}} and understand that violation may result in termination of my membership without refund.</p>

<h2>ACKNOWLEDGMENT</h2>

<p>I have read this agreement, fully understand its terms, and understand that I am giving up substantial rights by signing it. I acknowledge that I am signing this agreement freely and voluntarily.</p>

<p><strong>Emergency Contact:</strong> {{EMERGENCY_CONTACT_NAME}} - {{EMERGENCY_CONTACT_PHONE}}</p>

<div style="margin-top: 40px;">
  <p><strong>Participant Signature:</strong> _____________________________ <strong>Date:</strong> ___________</p>
  <p>{{PARTICIPANT_NAME}}</p>
</div>

<div style="margin-top: 20px;">
  <p><strong>Witness Signature:</strong> _____________________________ <strong>Date:</strong> ___________</p>
  <p>{{GYM_NAME}} Representative</p>
</div>
`;

export function generateLiabilityWaiver(data: {
  participantName: string;
  gymName: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
}): string {
  const today = new Date().toLocaleDateString();
  
  return DEFAULT_LIABILITY_WAIVER
    .replace(/{{PARTICIPANT_NAME}}/g, data.participantName)
    .replace(/{{GYM_NAME}}/g, data.gymName)
    .replace(/{{DATE}}/g, today)
    .replace(/{{EMERGENCY_CONTACT_NAME}}/g, data.emergencyContactName)
    .replace(/{{EMERGENCY_CONTACT_PHONE}}/g, data.emergencyContactPhone);
}

export async function createLiabilityWaiver(
  participantName: string,
  participantEmail: string,
  gymName: string,
  emergencyContactName: string,
  emergencyContactPhone: string,
  redirectUrl?: string,
  webhookUrl?: string
): Promise<InklessDocument> {
  const waiverContent = generateLiabilityWaiver({
    participantName,
    gymName,
    emergencyContactName,
    emergencyContactPhone,
  });

  return inklessAPI.createDocument({
    title: `Liability Waiver - ${participantName} - ${gymName}`,
    content: waiverContent,
    signer: {
      name: participantName,
      email: participantEmail,
    },
    redirect_url: redirectUrl,
    webhook_url: webhookUrl,
  });
}
