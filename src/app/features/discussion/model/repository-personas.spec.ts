import { repositoryImageOf, toRepositoryPersonas, withRepositoryPersonas } from './repository-personas';
import { EMPTY_STUDY, type Participant, type Study } from './study.model';

const ernst: Participant = {
  guid: 'f8f2f40a-a7b0-4aa3-96fb-e6809c63c62e',
  name: 'Ernst',
  initials: 'E',
  filled: true,
  role: 'Schnäppchenjäger',
  attributes: [{ label: 'segmentSharePercentage', value: '19' }],
};
const study: Study = { ...EMPTY_STUDY, screener: { title: '', criteria: [], participants: [ernst] } };

describe('withRepositoryPersonas', () => {
  it('fills the gaps from the repository and keeps what the recording says', () => {
    const [p] = withRepositoryPersonas(study, [
      {
        guid: 'F8F2F40A-A7B0-4AA3-96FB-E6809C63C62E',
        name: 'Ernst (19%)',
        imageUrl: 'https://media.example/ernst.png',
        role: 'Monteur',
        profile: '48, Mietwohnung',
        attributes: [
          { label: 'segmentSharePercentage', value: '20' },
          { label: 'Wohnort', value: 'Lindenau' },
        ],
      },
    ]).screener!.participants;
    expect(p.imageUrl).toBe('https://media.example/ernst.png');
    expect(p.role).toBe('Schnäppchenjäger');
    expect(p.profile).toBe('48, Mietwohnung');
    expect(p.name).toBe('Ernst');
    expect(p.attributes).toEqual([
      { label: 'segmentSharePercentage', value: '19' },
      { label: 'Wohnort', value: 'Lindenau' },
    ]);
  });

  it('leaves the study alone when the repository knows nobody', () => {
    expect(withRepositoryPersonas(study, [])).toBe(study);
  });
});

describe('repositoryImageOf', () => {
  it('prefers the recording’s own portrait', () => {
    const personas = [{ guid: 'm', name: 'Maren', imageUrl: 'https://media.example/maren.png' }];
    expect(repositoryImageOf('m', null, personas)).toBe('https://media.example/maren.png');
    expect(repositoryImageOf('m', 'own.png', personas)).toBe('own.png');
    expect(repositoryImageOf('x', null, personas)).toBeNull();
  });
});

describe('toRepositoryPersonas', () => {
  it('maps the rows of "Personas nach Guid"', () => {
    const [maren] = toRepositoryPersonas({
      uxmData: {
        personas: [
          {
            guid: 'f3cc44e7-44c6-42cf-b83b-c18e5df291fe',
            name: 'Maren',
            color: '#af79bd',
            quote: '',
            primaryRole_: { role: 'Moderatorin' },
            image_: { customSizePublicUrls: { m: 'https://media.example/maren.png?size=m' } },
            sociodemographicInfo: [
              { key: 'Gender', description: 'weiblich' },
              { key: 'Age', description: '38' },
              { key: 'Profession', description: 'Moderatorin' },
              { key: 'Nationality', description: 'deutsch' },
              { key: '', description: 'ohne Schlüssel' },
            ],
            profile: [{ description: '👥 Fokusgruppe: Moderatorin' }],
          },
        ],
      },
    });
    expect(maren).toEqual({
      guid: 'f3cc44e7-44c6-42cf-b83b-c18e5df291fe',
      name: 'Maren',
      imageUrl: 'https://media.example/maren.png?size=m',
      role: 'Moderatorin',
      profile: '👥 Fokusgruppe: Moderatorin',
      demographics: '38, weiblich, Moderatorin',
      color: '#af79bd',
      attributes: [{ label: 'Nationality', value: 'deutsch' }],
    });
  });

  it('reads an empty or missing answer as nobody', () => {
    expect(toRepositoryPersonas(null)).toEqual([]);
    expect(toRepositoryPersonas({ uxmData: { personas: [] } })).toEqual([]);
  });
});
