// AUR Desk — company profiles.
// Each company recolours the whole app when it is selected.
// No prices or client data live here: those stay on the phone only.

export const COMPANIES = {
  ventures: {
    id: 'ventures',
    name: 'AUR Ventures',
    short: 'Ventures',
    prefix: 'AURV',
    logo: 'logos/aur-ventures.jpg',
    theme: {
      primary: '#0A1433',      // buttons, active tab
      onPrimary: '#FFFFFF',
      hero: '#0A1433',         // summary card
      heroMuted: '#D9DCE6',    // small text on the summary card
      heroTrack: '#26304F',
      heroBar: '#F0B448',
      dot: '#F0B448',          // switcher dot
      soft: '#FBF3E2',         // segmented-control background
      border: '#EBDDBE',
      iconInk: '#A8721A',      // icons on white cards
    },
  },
  studio: {
    id: 'studio',
    name: 'AUR Studio',
    short: 'Studio',
    prefix: 'AURS',
    logo: 'logos/aur-studio.png',
    theme: {
      primary: '#303090',
      onPrimary: '#FFFFFF',
      hero: '#24246C',
      heroMuted: '#D8D2F0',
      heroTrack: '#3E3A8C',
      heroBar: '#B9A3E3',
      dot: '#7854A8',
      soft: '#ECEAF5',
      border: '#D9D3EC',
      iconInk: '#303090',
    },
  },
  printing: {
    id: 'printing',
    name: 'AUR Printing Studio',
    short: 'Printing',
    prefix: 'AURP',
    logo: 'logos/aur-printing-studio.png',
    theme: {
      primary: '#2F4A9A',
      onPrimary: '#FFFFFF',
      hero: '#1F3373',
      heroMuted: '#D6E2FA',
      heroTrack: '#34509A',
      heroBar: '#8EC3EC',
      dot: '#55A3DC',
      soft: '#E6ECFF',
      border: '#CCD7F5',
      iconInk: '#2F4A9A',
    },
  },
};

export const COMPANY_ORDER = ['studio', 'printing', 'ventures'];
