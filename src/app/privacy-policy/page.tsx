import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Bhoomi Dwellers",
  description:
    "Privacy Policy for the Bhoomi Dwellers CRM application and its associated Android application. Explains what data is collected, how it is used, and how it is protected.",
};

// This page is intentionally a Server Component with no authentication requirement.
export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[#F2F2F7] font-sans antialiased text-[#1C1C1E] selection:bg-[#007AFF]/20 pb-20">

      {/* ── Apple-Style Header ── */}
      <header className="bg-white border-b border-[#E5E5EA] pt-16 pb-12 px-6 text-center">
        <p className="text-[12px] font-bold uppercase tracking-widest text-[#8E8E93] mb-2">
          Bhoomi Dwellers CRM
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#9E217B] mb-3">
          Privacy Policy
        </h1>
        <p className="text-[13px] font-medium text-[#8E8E93]">
          Effective Date: October 1, 2026 &nbsp;|&nbsp; Last Updated: October 1, 2026
        </p>
      </header>

      {/* ── Content Wrapper ── */}
      <div className="max-w-[820px] mx-auto px-4 sm:px-6 mt-8 space-y-6">

        {/* Intro */}
        <Section>
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            This Privacy Policy describes how <strong>Bhoomi Dwellers</strong> (&ldquo;we&rdquo;,
            &ldquo;us&rdquo;, or &ldquo;our&rdquo;) collects, uses, stores, and shares
            information in connection with:
          </p>
          <ul className="list-disc pl-5 text-[15px] leading-relaxed text-[#333333] space-y-2 mb-4">
            <li>
              The <strong>Bhoomi Dwellers CRM</strong> web application, hosted at{" "}
              <a href="https://www.bhoomidwellers.com" className="text-[#007AFF] hover:underline">
                www.bhoomidwellers.com
              </a>; and
            </li>
            <li>
              The associated <strong>Android application</strong> (package ID:{" "}
              <code className="text-[13px] bg-[#F2F2F7] px-1.5 py-0.5 rounded-md text-[#FF3B30]">com.bhoomidwellers.crm</code>)
              provided for mobile access.
            </li>
          </ul>
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            This policy applies to authorized employees and users of the Bhoomi
            Dwellers CRM only. It does not apply to third-party services or websites
            that may be linked from within the application.
          </p>
          <p className="text-[15px] leading-relaxed text-[#333333]">
            By using the application, you acknowledge that you have read and
            understood this policy.
          </p>
        </Section>

        {/* Section 1 */}
        <Section heading="1. About Bhoomi Dwellers">
          <p className="text-[15px] leading-relaxed text-[#333333]">
            Bhoomi Dwellers operates a real-estate Customer Relationship Management
            (CRM) platform used internally by its employees to manage leads, customer
            enquiries, bookings, site visits, and related sales activity. The system
            is a private, business-facing application. It is not a consumer
            application open to the general public.
          </p>
        </Section>

        {/* Section 2 */}
        <Section heading="2. Scope of This Policy">
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            This policy covers the information that the CRM system collects and
            processes as part of its normal operation, including:
          </p>
          <ul className="list-disc pl-5 text-[15px] leading-relaxed text-[#333333] space-y-2">
            <li>Information about <strong>authorized employees and users</strong> who log in to the system;</li>
            <li>Information about <strong>leads, customers, and enquiries</strong> entered into the CRM by authorized employees;</li>
            <li>Technical, device, and usage information collected automatically during system operation.</li>
          </ul>
        </Section>

        {/* Section 3 */}
        <Section heading="3. Information We Collect">
          <SubHeading>3.1 Account and Authentication Information</SubHeading>
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            When an authorized employee logs in, the following information is collected and stored:
          </p>
          <ul className="list-disc pl-5 text-[15px] leading-relaxed text-[#333333] space-y-2 mb-6">
            <li><strong>Name and email address</strong> &mdash; used to identify the user and authenticate their session.</li>
            <li><strong>Role</strong> &mdash; the employee&apos;s assigned CRM role (e.g., Admin, Sales Manager, Caller, Receptionist, Site Head, Sourcing Manager), which determines their access level.</li>
            <li><strong>Password</strong> &mdash; stored in a securely hashed format. Plaintext passwords are never stored or transmitted after entry.</li>
            <li><strong>Session data</strong> &mdash; a secure, HttpOnly session cookie is issued upon login to exclusively identify the authenticated session.</li>
          </ul>

          <SubHeading>3.2 Customer, Lead, and CRM Information</SubHeading>
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            Authorized employees enter and manage records about prospective customers
            and real-estate enquiries. This information is entered by employees on
            behalf of the business and may include:
          </p>
          <ul className="list-disc pl-5 text-[15px] leading-relaxed text-[#333333] space-y-2 mb-6">
            <li>Customer and lead names, phone numbers, email addresses, and physical addresses.</li>
            <li>Enquiry details such as property interest, budget, source channel, and status.</li>
            <li>Site visit records, follow-up notes, and booking information.</li>
            <li>Financial information related to bookings (amounts, payment schedules &mdash; no payment card data is collected).</li>
            <li>Channel partner and commission information.</li>
          </ul>

          <SubHeading>3.3 Device and Technical Information</SubHeading>
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            When an employee logs in or uses the application, the following technical information is automatically collected:
          </p>
          <ul className="list-disc pl-5 text-[15px] leading-relaxed text-[#333333] space-y-2 mb-6">
            <li><strong>IP address</strong> &mdash; recorded at login for security and audit purposes.</li>
            <li><strong>Device details</strong> &mdash; used to identify the device type, operating system, and browser (e.g., &ldquo;Android Device&rdquo;).</li>
            <li><strong>Session timestamps</strong> &mdash; login time, last heartbeat, and session activity timestamps.</li>
          </ul>

          <SubHeading>3.4 Location Information</SubHeading>
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            <strong>Location is required to log in.</strong> When an employee attempts
            to log in to the CRM, the application requests precise GPS coordinates from the device.
            This is enforced securely: a login request is rejected if valid GPS coordinates are not provided.
          </p>
          <ul className="list-disc pl-5 text-[15px] leading-relaxed text-[#333333] space-y-2 mb-6">
            <li>Location is obtained <strong>at the time of login only</strong>. The application does not track location continuously in the background.</li>
            <li>The GPS coordinates provided at login are stored on the employee session record to verify presence and for attendance management.</li>
            <li>Coordinates are reverse-geocoded into a human-readable location name via a secure geocoding service partner. Only the coordinates are sent; no account identifiers are included.</li>
          </ul>

          <SubHeading>3.5 Call and Communication Information</SubHeading>
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            The CRM includes functionality for employees to initiate and log communications to leads and customers:
          </p>
          <ul className="list-disc pl-5 text-[15px] leading-relaxed text-[#333333] space-y-2 mb-6">
            <li><strong>Call session records</strong> &mdash; metadata including lead ID, phone number dialled, employee identifier, and call duration/status are recorded. Phone numbers are always read from the database, never supplied directly at call time.</li>
            <li><strong>Call recordings</strong> &mdash; audio files uploaded manually by an employee are stored securely in cloud-based object storage. Recordings are accessible only to authorized employees.</li>
            <li><strong>Telephony integrations</strong> &mdash; the system optionally integrates with telephony and AI voice partners for click-to-call and AI-assisted calls. When enabled, necessary phone numbers are securely transmitted to these service partners to facilitate the call.</li>
            <li><strong>WhatsApp messaging</strong> &mdash; the system optionally integrates with official messaging partners to send communications to leads. Message logs are stored securely in the CRM database.</li>
          </ul>

          <SubHeading>3.6 Employee Activity and Telemetry</SubHeading>
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            The CRM collects employee activity information for operational management:
          </p>
          <ul className="list-disc pl-5 text-[15px] leading-relaxed text-[#333333] space-y-2 mb-6">
            <li><strong>Session heartbeats</strong> &mdash; while logged in, the application periodically registers the current CRM module and idle status to power a live activity view for administrators.</li>
            <li><strong>Activity logs</strong> &mdash; actions such as opening a lead, adding a follow-up, or scheduling a visit are recorded.</li>
            <li><strong>Attendance records</strong> &mdash; employees mark their attendance, capturing login times and status.</li>
            <li><strong>Audit logs</strong> &mdash; sensitive actions (such as failed logins or record deletions) are logged for security oversight.</li>
          </ul>

          <SubHeading>3.7 Media and File Access</SubHeading>
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            The Android application declares permissions related to media and file access to support core functionality:
          </p>
          <ul className="list-disc pl-5 text-[15px] leading-relaxed text-[#333333] space-y-2 mb-6">
            <li><code className="text-[13px] bg-[#F2F2F7] px-1.5 py-0.5 rounded-md text-[#FF3B30]">READ_MEDIA_AUDIO</code> &mdash; used to read and upload audio files (call recordings) from the device.</li>
            <li><code className="text-[13px] bg-[#F2F2F7] px-1.5 py-0.5 rounded-md text-[#FF3B30]">READ_EXTERNAL_STORAGE</code> &mdash; used for file access on older Android versions.</li>
          </ul>

          <SubHeading>3.8 Cookies and Local Storage</SubHeading>
          <p className="text-[15px] leading-relaxed text-[#333333]">
            The application uses a secure session cookie to maintain authenticated sessions. This cookie is set upon login and expires after 7 days. <strong>No third-party advertising or tracking cookies are used.</strong> Local storage may be used solely to store interface preferences (such as color themes), which do not leave your device.
          </p>
        </Section>

        {/* Section 4 */}
        <Section heading="4. How We Use Information">
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">Information collected through the CRM is used for the following purposes:</p>
          <ul className="list-disc pl-5 text-[15px] leading-relaxed text-[#333333] space-y-2">
            <li><strong>Authentication and access control</strong> &mdash; to verify employee identity and enforce role-based access.</li>
            <li><strong>CRM operations</strong> &mdash; to enable employees to manage real-estate leads, enquiries, and bookings.</li>
            <li><strong>Workforce management</strong> &mdash; to record employee login times, locations, and attendance.</li>
            <li><strong>Communication</strong> &mdash; to facilitate integrated phone calls and messaging services.</li>
            <li><strong>Security and audit</strong> &mdash; to detect unauthorized access attempts and maintain operational audit trails.</li>
            <li><strong>Operational notifications</strong> &mdash; to send essential security emails (e.g., login alerts).</li>
          </ul>
        </Section>

        {/* Section 5 */}
        <Section heading="5. How We Share Information">
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            We do not sell personal information to third parties. Information may be shared in the following limited circumstances:
          </p>
          <ul className="list-disc pl-5 text-[15px] leading-relaxed text-[#333333] space-y-2">
            <li><strong>Within the organization</strong> &mdash; CRM data is visible to authorized employees based on role permissions.</li>
            <li><strong>Service providers</strong> &mdash; we use specialized cloud infrastructure providers to operate the application securely. Each provider receives only the data necessary to provide their service.</li>
            <li><strong>Legal requirements</strong> &mdash; we may disclose information if required by applicable law, court order, or legitimate governmental authority.</li>
          </ul>
        </Section>

        {/* Section 6 */}
        <Section heading="6. Service Providers">
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            The application relies on trusted enterprise service providers to deliver secure and reliable functionality:
          </p>

          <div className="overflow-hidden rounded-[14px] border border-[#E5E5EA]">
            <table className="w-full text-left border-collapse text-[14px]">
              <thead className="bg-[#F9F9F9] border-b border-[#E5E5EA]">
                <tr>
                  <Th>Category</Th>
                  <Th>Purpose</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E5EA]">
                <Tr>
                  <Td><strong>Cloud Hosting & Databases</strong></Td>
                  <Td>Hosts the application infrastructure and securely stores all CRM records, employee sessions, and audit data.</Td>
                </Tr>
                <Tr>
                  <Td><strong>Object Storage</strong></Td>
                  <Td>Provides secure, organization-scoped storage for uploaded files and call recordings.</Td>
                </Tr>
                <Tr>
                  <Td><strong>Telephony & Messaging</strong></Td>
                  <Td>Powers click-to-call integrations, WhatsApp business messaging, and AI-assisted voice communications.</Td>
                </Tr>
                <Tr>
                  <Td><strong>Mapping & Geocoding</strong></Td>
                  <Td>Converts login coordinates into human-readable locations and renders map interfaces.</Td>
                </Tr>
                <Tr>
                  <Td><strong>Transactional Email</strong></Td>
                  <Td>Delivers mandatory security alerts and operational notifications to employees.</Td>
                </Tr>
              </tbody>
            </table>
          </div>
        </Section>

        {/* Section 7 */}
        <Section heading="7. Data Storage and Security">
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            Application data and call recordings are stored securely using enterprise-grade cloud infrastructure hosted in the Asia-Pacific region.
          </p>
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            We implement reasonable technical and organizational safeguards to protect the information we hold, including:
          </p>
          <ul className="list-disc pl-5 text-[15px] leading-relaxed text-[#333333] space-y-2 mb-4">
            <li>Session cookies are HttpOnly, Secure, and cryptographically signed.</li>
            <li>All database connections and application traffic are strictly encrypted via TLS/SSL.</li>
            <li>Role-based access control is enforced at both the application and API layers.</li>
            <li>Significant administrative and security events are actively logged.</li>
            <li>The Android application enforces strict HTTPS security policies for all WebView traffic.</li>
          </ul>
          <p className="text-[15px] leading-relaxed text-[#333333]">
            While we utilize industry-standard practices, no security measure is absolute. We cannot guarantee the security of information in all circumstances.
          </p>
        </Section>

        {/* Section 8 */}
        <Section heading="8. Data Retention">
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            Information entered into the CRM is retained for as long as it is reasonably necessary for the business, operational, legal, or audit purposes described in this policy.
          </p>
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            Uploaded call recordings may be permanently deleted by authorized administrators from within the application. All deletions are permanently logged in the system audit trail.
          </p>
          <p className="text-[15px] leading-relaxed text-[#333333]">
            Employee session records, attendance records, and activity logs are retained as part of ongoing CRM operations.
          </p>
        </Section>

        {/* Section 9 */}
        <Section heading="9. User Rights and Choices">
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            As the Bhoomi Dwellers CRM is a private business application used by authorized employees, the following applies:
          </p>
          <ul className="list-disc pl-5 text-[15px] leading-relaxed text-[#333333] space-y-2">
            <li>Employees may update their profile information and password through the application&apos;s Settings page.</li>
            <li>Employees may view their own session history and actively terminate their live sessions.</li>
            <li>Employees who wish to request correction or deletion of their information may contact their system administrator.</li>
            <li>Location access may be denied in device settings; however, denying location permission will prevent login to the application, as location is a required input for authentication.</li>
          </ul>
        </Section>

        {/* Section 10 */}
        <Section heading="10. Android App Permissions">
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            The Android application (package ID: <code className="text-[13px] bg-[#F2F2F7] px-1.5 py-0.5 rounded-md text-[#FF3B30]">com.bhoomidwellers.crm</code>) requires the following permissions to function:
          </p>

          <div className="overflow-hidden rounded-[14px] border border-[#E5E5EA] mb-4">
            <table className="w-full text-left border-collapse text-[14px]">
              <thead className="bg-[#F9F9F9] border-b border-[#E5E5EA]">
                <tr>
                  <Th>Permission</Th>
                  <Th>Purpose</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E5EA]">
                <Tr>
                  <Td><code className="text-[12px] font-semibold text-[#FF3B30]">INTERNET</code></Td>
                  <Td>Required to securely communicate with the CRM servers.</Td>
                </Tr>
                <Tr>
                  <Td><code className="text-[12px] font-semibold text-[#FF3B30]">ACCESS_FINE_LOCATION</code></Td>
                  <Td>Used to obtain precise GPS coordinates at login. Location is required for authentication.</Td>
                </Tr>
                <Tr>
                  <Td><code className="text-[12px] font-semibold text-[#FF3B30]">READ_CALL_LOG</code></Td>
                  <Td>Used to support internal call session management capabilities on Android devices.</Td>
                </Tr>
                <Tr>
                  <Td><code className="text-[12px] font-semibold text-[#FF3B30]">READ_MEDIA_AUDIO</code></Td>
                  <Td>Used to securely upload local audio files (call recordings) from the device.</Td>
                </Tr>
              </tbody>
            </table>
          </div>
          <p className="text-[15px] leading-relaxed text-[#333333]">
            The application <strong>does not</strong> use camera, microphone, contacts, SMS, or background location permissions. No advertising SDKs are included.
          </p>
        </Section>

        {/* Section 11 */}
        <Section heading="11. Children&apos;s Privacy">
          <p className="text-[15px] leading-relaxed text-[#333333]">
            The Bhoomi Dwellers CRM is a private business application intended for use exclusively by adult employees of Bhoomi Dwellers. It is not directed at or intended for use by anyone under the age of 18. We do not knowingly collect personal information from minors.
          </p>
        </Section>

        {/* Section 12 */}
        <Section heading="12. Changes to This Privacy Policy">
          <p className="text-[15px] leading-relaxed text-[#333333] mb-4">
            We may update this Privacy Policy from time to time. When we make material changes, we will update the &ldquo;Last Updated&rdquo; date at the top of this page. We encourage users to review this page periodically.
          </p>
          <p className="text-[15px] leading-relaxed text-[#333333]">
            Continued use of the application after changes are published constitutes acceptance of the updated policy.
          </p>
        </Section>

        {/* Section 13 */}
        <Section heading="13. Contact Us">
          <p className="text-[15px] leading-relaxed text-[#333333] mb-5">
            If you have questions, concerns, or requests related to this Privacy Policy or the handling of your personal information, please contact us:
          </p>
          <div className="bg-[#F2F2F7] border border-[#E5E5EA] rounded-[16px] p-5">
            <p className="text-[16px] font-bold text-black mb-3">Bhoomi Dwellers</p>
            <div className="space-y-2">
              <p className="text-[14px] text-[#333333]">
                <span className="font-semibold text-[#8E8E93] uppercase tracking-wider text-[11px] w-20 inline-block">Email</span>
                <a href="mailto:support@bhoomidwellers.com" className="text-[#007AFF] font-medium hover:underline">
                  mayurac123@gmail.com
                </a>
              </p>
              <p className="text-[14px] text-[#333333]">
                <span className="font-semibold text-[#8E8E93] uppercase tracking-wider text-[11px] w-20 inline-block">Website</span>
                <a href="https://www.bhoomidwellers.com" className="text-[#007AFF] font-medium hover:underline">
                  www.bhoomidwellers.com
                </a>
              </p>
            </div>
          </div>
        </Section>
      </div>

      {/* ── Footer ── */}
      <footer className="mt-12 border-t border-[#E5E5EA] pt-8 pb-4 text-center">
        <p className="text-[13px] font-medium text-[#8E8E93]">
          &copy; {new Date().getFullYear()} Bhoomi Dwellers. All rights reserved.
        </p>
        <p className="text-[12px] mt-1 text-[#8E8E93] opacity-80">
          This page is publicly accessible without login.
        </p>
      </footer>
    </main>
  );
}

/* ── Apple-Style Layout Helpers ─────────────────────────────────────────────── */

function Section({
  heading,
  children,
}: {
  heading?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-[24px] p-6 sm:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] border border-[#E5E5EA]">
      {heading && (
        <h2 className="text-[19px] text-[#9E217B] sm:text-[22px] font-bold tracking-tight mb-5 border-b border-[#F2F2F7] pb-3">
          {heading}
        </h2>
      )}
      <div className="text-[#333333]">
        {children}
      </div>
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[16px] sm:text-[17px] font-semibold tracking-tight text-black mt-8 mb-3">
      {children}
    </h3>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left font-semibold text-[13px] text-[#8E8E93] uppercase tracking-wider">
      {children}
    </th>
  );
}

function Tr({ children }: { children: React.ReactNode }) {
  return <tr className="transition-colors hover:bg-black/[0.01]">{children}</tr>;
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-4 py-3.5 align-top text-[14px] leading-relaxed text-[#333333]">
      {children}
    </td>
  );
}