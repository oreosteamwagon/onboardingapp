'use client'

import Link from 'next/link'
import { useBranding } from '@/components/BrandingProvider'

export default function PrivacyPolicyPage() {
  const { orgName } = useBranding()
  const lastUpdated = 'August 31, 2026'

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link href="/dashboard" className="text-sm text-primary hover:underline">
          &larr; Back to dashboard
        </Link>

        <h1 className="mt-4 text-3xl font-semibold text-gray-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-gray-500">Last updated: {lastUpdated}</p>

        <div className="mt-8 space-y-8 text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-gray-900">1. Introduction</h2>
            <p className="mt-2">
              {orgName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) operates this
              employee onboarding portal (the &ldquo;Service&rdquo;). This policy explains what
              personal information we collect through the Service, how we use and protect it, and
              the choices available to you as an employee, contractor, or approver using the
              Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">2. Information We Collect</h2>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>Account information: name, email address, and assigned role.</li>
              <li>
                Onboarding data: task and checklist progress, approval decisions, and workflow
                status.
              </li>
              <li>
                Documents you upload: identification documents, certificates, and other files
                submitted as part of onboarding or task completion.
              </li>
              <li>
                Usage and security logs: sign-in activity, IP address, and actions taken within
                the Service, used to detect abuse and secure accounts.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">3. How We Use Your Information</h2>
            <p className="mt-2">We use the information above to:</p>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>Operate onboarding workflows, task assignments, and approvals.</li>
              <li>Verify identity and eligibility documents where required.</li>
              <li>Maintain the security and integrity of the Service, including rate limiting and fraud prevention.</li>
              <li>Communicate onboarding status, reminders, and account-related notices.</li>
              <li>Comply with legal, regulatory, and record-keeping obligations.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">4. Who Can Access Your Information</h2>
            <p className="mt-2">
              Access to your information is restricted based on role. Supervisors, HR, and payroll
              personnel may access onboarding progress and submitted documents relevant to their
              approval responsibilities. Administrators may access account and configuration data
              needed to operate the Service. We do not sell your personal information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">5. Data Retention</h2>
            <p className="mt-2">
              We retain onboarding records and submitted documents for as long as needed to fulfill
              the purposes described in this policy and to meet legal, tax, or regulatory retention
              requirements. When information is no longer needed, it is securely deleted or
              anonymized.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">6. Data Security</h2>
            <p className="mt-2">
              We apply technical and organizational safeguards to protect your information,
              including encrypted storage of sensitive documents, role-based access controls,
              audit logging, and rate limiting on authentication. No system is completely secure,
              and we encourage you to report suspected security issues to your administrator.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">7. Your Choices</h2>
            <p className="mt-2">
              You may request access to, correction of, or deletion of your personal information,
              subject to our legal and record-keeping obligations, by contacting your HR
              administrator.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">8. Changes to This Policy</h2>
            <p className="mt-2">
              We may update this policy from time to time. Material changes will be reflected by
              updating the &ldquo;Last updated&rdquo; date above.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">9. Contact Us</h2>
            <p className="mt-2">
              If you have questions about this policy or how your information is handled, contact
              your {orgName} HR or administration team.
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
