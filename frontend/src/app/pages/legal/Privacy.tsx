// /privacy — public. Describes what this deployment actually stores and sends where;
// every retention figure below mirrors a value in the backend (Trace TTL 30 days,
// session TTL 7 days, snapshot retention 7 days). Change the code, change this page.
import { Link } from 'react-router';
import { ContactLink, LegalList, LegalPage, LegalSection } from './LegalPage';

export function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Cerebro (cerebrodigital.tech) lets you upload documents and ask questions that are answered
        from those documents, with citations. It is an independent project run by its developer, not
        a company. This page explains what Cerebro stores about you, which services process it, and
        how to delete it.
      </p>

      <LegalSection title="1. What Cerebro stores">
        <LegalList>
          <li>
            <strong className="text-ink">Account details</strong>: your email address and name. If you
            sign up with a password, only a one-way argon2id hash of it is stored, never the password
            itself. If you sign in with Google or GitHub, Cerebro receives your name, email address,
            profile picture and account ID from that provider. It never receives your Google or
            GitHub password.
          </li>
          <li>
            <strong className="text-ink">Your documents</strong>: the files you upload, the text
            extracted from them, images of their pages, and the search index built from that text.
          </li>
          <li>
            <strong className="text-ink">Your conversations</strong>: the questions you ask and the
            answers and citations Cerebro returns.
          </li>
          <li>
            <strong className="text-ink">Diagnostic records</strong>: for each answer, a trace of how it
            was produced (your question, the passages retrieved, and timings). Traces are deleted
            automatically after 30 days. Usage counts (for example, how many pages were parsed) are
            kept to enforce per-account limits.
          </li>
          <li>
            <strong className="text-ink">A session cookie</strong> that keeps you signed in for up to 7
            days. Cerebro uses no advertising or analytics cookies and no third-party trackers.
          </li>
          <li>
            <strong className="text-ink">Server logs</strong>: IP address and request details, kept
            briefly for security and troubleshooting.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="2. How it is used">
        <p>
          Your data is used only to run Cerebro for you: to sign you in, to index your documents, and
          to answer your questions from them. Cerebro does not sell your data, show advertising, or use
          your documents to train any model of its own.
        </p>
      </LegalSection>

      <LegalSection title="3. Services that process your data">
        <p>Cerebro relies on these providers. Each receives only what its job requires:</p>
        <LegalList>
          <li>
            <strong className="text-ink">Google Cloud</strong> hosts the server and all stored data, in
            the Mumbai (asia-south1) region, India.
          </li>
          <li>
            <strong className="text-ink">LlamaIndex (LlamaParse)</strong> receives uploaded PDF and Word
            files to extract their text.
          </li>
          <li>
            <strong className="text-ink">Cohere</strong> receives passages of your documents and your
            questions to build and rank the search index.
          </li>
          <li>
            <strong className="text-ink">Google Gemini API</strong> receives your question with the
            passages and page images retrieved for it, and writes the answer. Cerebro currently uses the
            Gemini API's free tier, under whose terms Google may use submitted content to improve its
            products. <strong className="text-ink">Do not upload documents you are not comfortable
            sharing on those terms.</strong>
          </li>
          <li>
            <strong className="text-ink">Google and GitHub</strong> authenticate you, only if you choose
            to sign in with them.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="4. Keeping and deleting your data">
        <LegalList>
          <li>
            Deleting a <strong className="text-ink">document</strong> removes the file, its page images
            and its search index entries.
          </li>
          <li>
            Deleting a <strong className="text-ink">context</strong> removes every document,
            conversation and trace in it.
          </li>
          <li>
            Deleting a <strong className="text-ink">conversation</strong> removes its messages; its
            traces expire within 30 days.
          </li>
          <li>
            To delete your <strong className="text-ink">whole account</strong>, email <ContactLink />{' '}
            from the address you signed up with. It is deleted within 30 days.
          </li>
          <li>
            The server's disk is backed up daily and each backup is kept for 7 days, so deleted data
            can remain in a backup for up to 7 days after deletion.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="5. Security">
        <p>
          All traffic is encrypted with HTTPS. Each account can see only its own documents and
          conversations. Passwords are stored as argon2id hashes, and the server accepts administrative
          access only through Google's authenticated tunnel. No system is perfectly secure; if you
          believe you have found a vulnerability, please email <ContactLink />.
        </p>
      </LegalSection>

      <LegalSection title="6. Your rights">
        <p>
          You can ask for a copy of your data, a correction, or its deletion by emailing <ContactLink />.
          Cerebro is not intended for anyone under 18.
        </p>
      </LegalSection>

      <LegalSection title="7. Changes">
        <p>
          If this policy changes, the effective date at the top changes with it. Material changes will
          be announced on the sign-in page. See also the <Link to="/terms" className="font-medium text-signal hover:underline">Terms of Service</Link>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
