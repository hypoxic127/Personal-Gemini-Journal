import React from 'react';
import { ShieldCheck, Lock, Cpu, Database, AlertTriangle } from 'lucide-react';
import type { ThreatZoneRisk } from '../types';

export const THREAT_MODEL_DATA: ThreatZoneRisk[] = [
  {
    threatZone: '1. Input Surfaces',
    riskDescription: 'Prompt injection via untrusted user inputs or malicious payload formatting.',
    owaspMapping: 'OWASP LLM01 / OWASP A03',
    countermeasure: 'Strict JSON payload boundaries, server-side parameterization, input sanitization, and defensive null-safe destructuring.',
    status: 'Enforced',
  },
  {
    threatZone: '2. Planning & Reasoning',
    riskDescription: 'System instruction hijacking or unintended role confusion during reflection.',
    owaspMapping: 'OWASP LLM01 / LLM02',
    countermeasure: 'Isolated system prompts, contextual role framing, explicit reflection boundaries, and structured JSON generation.',
    status: 'Enforced',
  },
  {
    threatZone: '3. Tool Execution',
    riskDescription: 'Privilege escalation or unauthorized server-side compute/API execution.',
    owaspMapping: 'OWASP A01 / LLM06',
    countermeasure: 'No dynamic shell execution sinks, controlled express API routes, strict error boundary isolation.',
    status: 'Enforced',
  },
  {
    threatZone: '4. Memory & State',
    riskDescription: 'Cross-user data leakage, session tampering, or unauthorized Firestore reads/writes.',
    owaspMapping: 'OWASP A01 / A04',
    countermeasure: 'Strict owner-bound Firestore security rules (/users/{userId}/**), request.auth.uid validation, and undefined-stripping payload hygiene.',
    status: 'Enforced',
  },
  {
    threatZone: '5. Inter-System Communication',
    riskDescription: 'Gemini API key leakage, token sniffing, or unencrypted transit.',
    owaspMapping: 'OWASP A02 / LLM10',
    countermeasure: 'Backend-only Secret Manager / environment variable storage, zero client exposure, resilient 4-model fallback ladder.',
    status: 'Enforced',
  },
];

interface ThreatSummaryTableProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ThreatSummaryTable: React.FC<ThreatSummaryTableProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#4A443F]/50 backdrop-blur-xs animate-fadeIn">
      <div
        id="threat-model-modal"
        className="bg-[#FAF8F5] rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-[#E2DDD5]"
      >
        <div className="px-6 py-5 border-b border-[#E2DDD5] flex items-center justify-between bg-[#EAE5DD]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-[#5A5A40] text-[#FAF8F5] rounded-lg">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-serif tracking-tight text-[#4A443F]">Agentic Threat Model & Security Specification</h2>
              <p className="text-xs text-[#7D756D]">5 Threat Zones mapped to OWASP LLM & Cloud Security Countermeasures</p>
            </div>
          </div>
          <button
            id="close-threat-model-btn"
            onClick={onClose}
            className="text-[#7D756D] hover:text-[#4A443F] p-2 rounded-lg hover:bg-[#DFD8CE] transition-colors text-sm font-medium cursor-pointer"
          >
            ✕ Close
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 bg-[#FAF8F5]">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-white border border-[#E2DDD5] shadow-2xs">
              <div className="flex items-center space-x-2 text-[#5A5A40] mb-1">
                <Lock className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Identity & Auth</span>
              </div>
              <p className="text-xs text-[#7D756D]">
                Federated Google Sign-In via Firebase Auth. Cryptographically verified Bearer tokens on every backend API request.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white border border-[#E2DDD5] shadow-2xs">
              <div className="flex items-center space-x-2 text-[#5A5A40] mb-1">
                <Database className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Data Isolation</span>
              </div>
              <p className="text-xs text-[#7D756D]">
                Cloud Firestore user-bound paths (<code className="text-[#5A5A40] bg-[#EAE5DD] px-1 py-0.5 rounded font-mono text-[11px]">/users/{'{uid}'}/**</code>). Client direct writes completely prohibited.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white border border-[#E2DDD5] shadow-2xs">
              <div className="flex items-center space-x-2 text-[#5A5A40] mb-1">
                <Cpu className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">API Zero-Exposure</span>
              </div>
              <p className="text-xs text-[#7D756D]">
                Gemini API Key locked server-side with 4-tier model fallback ladder. Zero keys exposed in client bundles.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[#E2DDD5] bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#EAE5DD] text-[#4A443F] text-xs uppercase font-semibold">
                <tr>
                  <th className="py-3 px-4">Threat Zone</th>
                  <th className="py-3 px-4">Identified Risk</th>
                  <th className="py-3 px-4">OWASP Mapping</th>
                  <th className="py-3 px-4">Implemented Countermeasure</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2DDD5] text-[#4A443F] text-xs">
                {THREAT_MODEL_DATA.map((item, idx) => (
                  <tr key={idx} className="hover:bg-[#FAF8F5] transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-[#4A443F] whitespace-nowrap">{item.threatZone}</td>
                    <td className="py-3.5 px-4 text-[#7D756D]">{item.riskDescription}</td>
                    <td className="py-3.5 px-4">
                      <span className="inline-block px-2 py-0.5 rounded bg-[#EFECE6] text-[#5A5A40] border border-[#DCD3C6] font-mono text-[11px]">
                        {item.owaspMapping}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-[#4A443F] leading-relaxed">{item.countermeasure}</td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#EAE5DD] text-[#5A5A40] border border-[#DCD3C6]">
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-4 bg-[#EAE5DD] rounded-xl border border-[#DCD3C6] text-[#4A443F] text-xs flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-[#5A5A40] shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Firestore Security Rule Integrity:</span>
              <p className="mt-0.5 text-[#7D756D]">
                Deployed security rules enforce <code className="bg-[#FAF8F5] border border-[#DCD3C6] px-1 py-0.5 rounded font-mono text-[#5A5A40]">request.auth != null && request.auth.uid == uid</code> for reads, and <code className="bg-[#FAF8F5] border border-[#DCD3C6] px-1 py-0.5 rounded font-mono text-[#5A5A40]">allow write: if false</code> on all user content collections.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-[#FAF8F5] border-t border-[#E2DDD5] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#5A5A40] text-[#FAF8F5] rounded-xl text-xs font-semibold hover:bg-[#484833] transition-colors cursor-pointer"
          >
            Acknowledge & Close
          </button>
        </div>
      </div>
    </div>
  );
};