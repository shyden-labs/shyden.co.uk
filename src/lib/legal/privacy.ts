/**
 * The privacy page (#1080), as one document the page renders.
 *
 * Kept out of `src/lib/i18n` on purpose: whatever sits in a catalogue is
 * drafted by DeepL and read back by Google, and the global legal-pages rule
 * (2026-11-08) keeps this text out of both. #1082's Indonesian copy is a
 * second `LegalDocument`, written from this one.
 *
 * The words are Shyden's approved wording of 2026-11-22. Change them only
 * with his approval, and change `updated` in the same edit.
 */

/** Running text, or a link within it. */
export type Inline = string | { readonly text: string; readonly href: string };

/** A paragraph, or a bulleted list whose items are runs of inline text. */
export type Block =
  | { readonly kind: 'p'; readonly parts: readonly Inline[] }
  | { readonly kind: 'ul'; readonly items: readonly (readonly Inline[])[] };

export interface LegalDocument {
  readonly title: string;
  readonly description: string;
  readonly heading: string;
  /** Written out, since no page reads the clock (`no-dated-render.test.ts`). */
  readonly updated: string;
  /** The opening, under the main heading. */
  readonly lead: readonly Block[];
  readonly sections: readonly {
    readonly heading: string;
    readonly blocks: readonly Block[];
  }[];
}

export const PRIVACY_EN: LegalDocument = {
  title: 'Privacy — Shyden',
  description: 'What shyden.co.uk keeps about visitors, why, and for how long.',
  heading: 'Privacy',
  updated: 'Last updated 22 November 2026.',
  lead: [
    {
      kind: 'p',
      parts: [
        'This page explains what shyden.co.uk keeps about visitors, why, and for how long. The site is run by Shyden Labs, from Indonesia, and Shyden Labs is responsible for the data described here.',
      ],
    },
  ],
  sections: [
    {
      heading: 'In short',
      blocks: [
        {
          kind: 'ul',
          items: [
            ['No cookies, no analytics, no advertising and no tracking.'],
            [
              'No accounts. Nothing asks for a name or an email address, except the support form.',
            ],
            ['The Classroom Group Creator never stores or sends a class list.'],
          ],
        },
      ],
    },
    {
      heading: 'Translation reports',
      blocks: [
        {
          kind: 'p',
          parts: [
            "Pages in Indonesian, Chinese, Vietnamese and Thai have a form for reporting a translation mistake. A report keeps the words quoted, the suggested wording, the optional note, the page and language it came from, and the time it arrived. It keeps no name, email address or internet address, so please don't put personal details in the note.",
          ],
        },
        {
          kind: 'p',
          parts: [
            "Reports are deleted after about a year: once a report's year is up, it is deleted when the next report arrives.",
          ],
        },
      ],
    },
    {
      heading: 'The daily limit on reports',
      blocks: [
        {
          kind: 'p',
          parts: [
            "To stop the form being flooded, each internet connection can send only a limited number of reports a day. To count them, the site turns the connection's address and the date into a code that cannot be turned back into the address without a secret key. The address itself is never stored, and each day's counts are deleted when the first report of a later day arrives.",
          ],
        },
      ],
    },
    {
      heading: 'The support form',
      blocks: [
        {
          kind: 'p',
          parts: [
            'The ',
            { text: 'support page', href: '/support' },
            ' uses ShyDesk, the support service Shyden Labs runs for all its products. The form asks for an email address, a subject, a category and a message, and can take photos and short videos.',
          ],
        },
        {
          kind: 'ul',
          items: [
            [
              'The message, its replies and the email address are kept until a year after the conversation is closed. Photos and videos are deleted 30 days after it is closed. If it is reopened, the clock stops. Anything covered by a legal obligation to preserve it, or reported to the authorities, is kept for as long as that obligation lasts.',
            ],
            [
              'Your internet address is checked by Cloudflare Turnstile, which keeps automated spam out, and is used to count requests so that no one can flood the form. Those counts are deleted within about an hour.',
            ],
            [
              "Replies are announced by email. That email holds only the product's name and a private link to the conversation, never the message itself. It is sent through Sparked Host's mail server in France.",
            ],
            [
              'Anyone who has the private link can read the whole conversation and reply, so keep it to yourself.',
            ],
          ],
        },
      ],
    },
    {
      heading: 'Hosting and request records',
      blocks: [
        {
          kind: 'p',
          parts: [
            "The site and ShyDesk run on Cloudflare, which stores the reports, the counts and the support conversations. ShyDesk's data is kept in Cloudflare's Asia-Pacific region. Cloudflare handles every request to either one and keeps its own records of them, under ",
            {
              text: "Cloudflare's privacy policy",
              href: 'https://www.cloudflare.com/privacypolicy/',
            },
            ". ShyDesk's own request records, which include your internet address, your browser and an approximate location, are kept for 3 days.",
          ],
        },
      ],
    },
    {
      heading: 'Kept in your browser only',
      blocks: [
        {
          kind: 'p',
          parts: [
            "A few choices are saved in your browser, on your device, and are never sent anywhere: the light or dark theme, and on the Classroom Group Creator whether its instructions are open and whether sound is on. Clearing this site's data in your browser removes them.",
          ],
        },
        {
          kind: 'p',
          parts: [
            'A class list stays in the open page and in any file you save from it. It is never sent to the site or stored by it.',
          ],
        },
      ],
    },
    {
      heading: 'Why this data is used',
      blocks: [
        {
          kind: 'p',
          parts: [
            "Reports are used only to correct translations, and the support form only to answer you. The counts and records are used only to keep the site and the form working and to prevent abuse. All of it rests on legitimate interest, under Article 20(2)(f) of Indonesia's Personal Data Protection Law (UU 27/2022), and none of it is sold or shared for advertising.",
          ],
        },
      ],
    },
    {
      heading: 'Other sites',
      blocks: [
        {
          kind: 'p',
          parts: [
            'Links to ShyTalk, Yawelo Idle and other sites lead to services with their own privacy pages.',
          ],
        },
      ],
    },
    {
      heading: 'Your rights',
      blocks: [
        {
          kind: 'p',
          parts: [
            'You can ask what is held about you, and ask for it to be corrected or deleted, or object to its use. A translation report holds nothing that identifies who sent it, so it can only be found by its words: quote them. Send any request through the ',
            { text: 'support page', href: '/support' },
            '. You can also complain to the data protection authority where you live.',
          ],
        },
      ],
    },
    {
      heading: 'Changes',
      blocks: [
        {
          kind: 'p',
          parts: [
            'Changes to this page are posted here, with a new date, before they take effect.',
          ],
        },
      ],
    },
  ],
};

/** #1082 stub: the Indonesian copy, written with its code. */
export const PRIVACY_ID: LegalDocument = {
  title: '',
  description: '',
  heading: '',
  updated: '',
  lead: [],
  sections: [],
};

const words = (run: readonly Inline[]): string =>
  run.map((part) => (typeof part === 'string' ? part : part.text)).join('');

/**
 * What a reader sees of each paragraph and list item, in order: the lines
 * the page must show, and the lines no translation store may hold.
 */
export function legalTexts(doc: LegalDocument): string[] {
  const blocks = [...doc.lead, ...doc.sections.flatMap((s) => s.blocks)];
  return blocks.flatMap((block) =>
    block.kind === 'p' ? [words(block.parts)] : block.items.map(words),
  );
}
