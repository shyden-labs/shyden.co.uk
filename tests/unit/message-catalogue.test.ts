import { describe, expect, it } from 'vitest';
import {
  MessageSyntaxError,
  compileCatalogue,
  type Message,
} from '../../src/lib/i18n/message';

/**
 * How a catalogue becomes what a page calls (#136).
 *
 * A catalogue holds only data: plain copy, arrays of copy, and templates.
 * The REFERENCE catalogue (English) decides which entries are templates, by
 * declaring them `as Message<{ … }>`, and compiling turns each of those into a
 * function of its named slots, bound to the page's locale. A translation is
 * plain strings throughout, so a translator never sees anything but prose.
 */

const reference = {
  title: 'Classroom Group Creator',
  steps: ['Say how big your class is.'],
  greeting: 'Hello {name}' as Message<{ name: string }>,
  errors: {
    NO_STUDENTS: 'Add at least one student.',
    TOO_MANY:
      'The most is {max} {max, plural, one {student} other {students}}.' as Message<{
        max: number;
      }>,
  },
};

const indonesian = {
  title: 'Pembuat Kelompok Kelas',
  steps: ['Sebutkan jumlah siswa.'],
  greeting: 'Halo {name}',
  errors: {
    NO_STUDENTS: 'Tambahkan minimal satu siswa.',
    TOO_MANY: 'Paling banyak {max} siswa.',
  },
};

describe('compileCatalogue', () => {
  it('turns every template the reference declares into a function of its slots', () => {
    const id = compileCatalogue(reference, indonesian, 'id-ID');
    expect(id.greeting({ name: 'Ana' })).toBe('Halo Ana');
    expect(id.errors.TOO_MANY({ max: 1 })).toBe('Paling banyak 1 siswa.');
  });

  it('keeps plain copy and arrays exactly as the catalogue wrote them', () => {
    const id = compileCatalogue(reference, indonesian, 'id-ID');
    expect(id.title).toBe('Pembuat Kelompok Kelas');
    expect(id.steps).toEqual(['Sebutkan jumlah siswa.']);
    expect(id.errors.NO_STUDENTS).toBe('Tambahkan minimal satu siswa.');
  });

  it('formats with the locale it was compiled for', () => {
    const en = compileCatalogue(reference, reference, 'en-GB');
    expect(en.errors.TOO_MANY({ max: 1 })).toBe('The most is 1 student.');
    expect(en.errors.TOO_MANY({ max: 2 })).toBe('The most is 2 students.');
  });

  it('rejects a malformed translation when compiled, not when a teacher first triggers it', () => {
    expect(() =>
      compileCatalogue(
        reference,
        { ...indonesian, greeting: 'Halo {name' },
        'id-ID',
      ),
    ).toThrow(MessageSyntaxError);
  });

  it('refuses a catalogue that leaves a template out, naming where', () => {
    const incomplete = { ...indonesian, greeting: undefined };
    expect(() =>
      compileCatalogue(reference, incomplete as never, 'id-ID'),
    ).toThrow(/greeting/);
  });
});
