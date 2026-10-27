// /terms — public. Plain-language terms for an independent, free, best-effort service.
import { Link } from 'react-router';
import { ContactLink, LegalList, LegalPage, LegalSection } from './LegalPage';

export function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms apply to your use of Cerebro at cerebrodigital.tech. By creating an account or
        using Cerebro, you agree to them. If you do not agree, do not use Cerebro.
      </p>

      <LegalSection title="1. The service">
        <p>
          Cerebro answers questions from documents you upload. It is an independent project, offered
          free of charge and on a best-effort basis. Features, usage limits and availability may change,
          and the service may be interrupted or discontinued.
        </p>
      </LegalSection>

      <LegalSection title="2. Your account">
        <p>
          Give accurate information when you sign up, keep your password private, and tell us at{' '}
          <ContactLink /> if you believe someone else has accessed your account. You are responsible for
          activity under your account.
        </p>
      </LegalSection>

      <LegalSection title="3. Your content">
        <p>
          You keep ownership of everything you upload. You allow Cerebro to store and process it, and
          to send it to the providers listed in the{' '}
          <Link to="/privacy" className="font-medium text-signal hover:underline">Privacy Policy</Link>, only
          to provide the service to you. Upload only content you have the right to use.
        </p>
      </LegalSection>

      <LegalSection title="4. Acceptable use">
        <p>Do not use Cerebro to:</p>
        <LegalList>
          <li>upload anything illegal, malicious (such as malware), or that infringes someone else's rights;</li>
          <li>upload other people's personal data without a lawful basis;</li>
          <li>access, or try to access, another account's data;</li>
          <li>probe, overload or attack the service, or get around its usage limits;</li>
          <li>scrape or resell the service.</li>
        </LegalList>
        <p>Accounts that break these rules may be suspended or deleted without notice.</p>
      </LegalSection>

      <LegalSection title="5. AI-generated answers">
        <p>
          Answers are written by an AI model from passages of your documents. They can be incomplete or
          wrong even when they cite a source. Check the cited passages before relying on an answer, and
          do not treat answers as professional (legal, medical, financial or other) advice.
        </p>
      </LegalSection>

      <LegalSection title="6. No warranty; limitation of liability">
        <p>
          Cerebro is provided "as is", without warranties of any kind. Keep your own copies of your
          documents; Cerebro is not a backup service. To the extent the law allows, the operator is not
          liable for any loss of data, profits or other indirect damages arising from your use of
          Cerebro.
        </p>
      </LegalSection>

      <LegalSection title="7. Ending your use">
        <p>
          You can stop using Cerebro at any time and ask for your account to be deleted, as described in
          the Privacy Policy. Cerebro may suspend accounts that break these terms.
        </p>
      </LegalSection>

      <LegalSection title="8. Changes and contact">
        <p>
          If these terms change, the effective date at the top changes with them. These terms are
          governed by the laws of India. Questions: <ContactLink />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
