// Personnages de la course, en illustration à plat : couleurs unies, pas de contour,
// membres plus sombres à l'arrière pour la profondeur. Dessinés de profil, vers la droite.
// Repère : viewBox 0 0 100 140, hanche en (50, 74), genou en (50, 102), épaule en (57, 40).
// Le haut du corps est penché vers l'avant de LEAN degrés autour de la hanche.

const LEAN = 9;

const PALETTES = {
  bleu: {
    shirt: '#2f63e0', shirtDark: '#1f47a8',
    skin: '#f1c6a3', skinDark: '#d6a17e', hair: '#5b3a22',
  },
  rouge: {
    shirt: '#e23b30', shirtDark: '#a82a22',
    skin: '#a8714f', skinDark: '#87573a', hair: '#1d1612',
  },
};
const BOTTOM = '#2b2f3a';
const BOTTOM_DARK = '#1a1d25';
const SHOE = '#f5f5f2';
const SHOE_DARK = '#b9bab5';
const SOLE = '#ffb02e';

const line = (x1, y1, x2, y2, color, width) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;

function leg(side, gender, c) {
  const near = side === 'near';
  const skin = near ? c.skin : c.skinDark;
  const bottom = near ? BOTTOM : BOTTOM_DARK;
  const shoe = near ? SHOE : SHOE_DARK;
  // Homme : short au-dessus du genou. Femme : legging jusqu'au mollet.
  const thigh = gender === 'femme'
    ? line(50, 74, 50, 102, bottom, 12)
    : line(50, 74, 50, 102, skin, 10.5) + line(50, 73, 50, 89, bottom, 15);
  const shin = gender === 'femme'
    ? line(50, 102, 50, 121, bottom, 9.5) + line(50, 120, 50, 128, skin, 7.5)
    : line(50, 102, 50, 128, skin, 8.5);
  return `
    <g class="leg leg-${side}" style="transform-origin:50px 74px">
      ${thigh}
      <g class="shin" style="transform-origin:50px 102px">
        ${shin}
        <path d="M44,127 Q46,124 52,125 L60,128 Q63,130 61,133 L45,133 Q43,131 44,127 Z" fill="${shoe}"/>
        <path d="M44,132 L61,132 Q62,134 60,135 L45,135 Q43,134 44,132 Z" fill="${SOLE}"/>
      </g>
    </g>`;
}

function arm(side, c) {
  const near = side === 'near';
  const skin = near ? c.skin : c.skinDark;
  const sleeve = near ? c.shirt : c.shirtDark;
  return `
    <g transform="rotate(${LEAN} 50 74)">
      <g class="arm arm-${side}" style="transform-origin:57px 40px">
        ${line(57, 40, 57, 58, skin, 7.5)}
        ${line(57, 39, 57, 48, sleeve, 10.5)}
        <g class="forearm" style="transform-origin:57px 58px">
          ${line(57, 58, 57, 73, skin, 7)}
          <circle cx="57" cy="75" r="4.2" fill="${skin}"/>
        </g>
      </g>
    </g>`;
}

function torso(gender, c) {
  const shape = gender === 'femme'
    ? 'M52,35 Q61,30 64,40 Q65,49 60,58 Q58,66 60,76 L42,76 Q45,66 45,58 Q45,45 52,35 Z'
    : 'M51,35 Q62,30 65,40 Q67,55 60,76 L40,76 Q41,53 51,35 Z';
  return `
    <rect x="39" y="69" width="23" height="12" rx="6" fill="${BOTTOM}"/>
    <g transform="rotate(${LEAN} 50 74)"><path d="${shape}" fill="${c.shirt}"/></g>`;
}

function head(gender, c) {
  const hair = gender === 'femme'
    ? `<g class="ponytail" style="transform-origin:54px 17px">
         <path d="M55,15 Q45,9 35,15 Q31,19 27,18 Q32,25 41,22 Q36,27 31,29 Q44,31 55,21 Z" fill="${c.hair}"/>
       </g>
       <path d="M52,26 Q50,11 63,11 Q75,11 74,21 Q67,15 60,19 Q57,22 56,30 Q53,30 52,26 Z" fill="${c.hair}"/>
       <circle cx="54.5" cy="16.5" r="2.4" fill="${SOLE}"/>`
    : `<path d="M53,25 Q51,12 63,11.5 Q74,11 74,19 Q68,15.5 61,18 Q58,21 57.5,28 Q54,28 53,25 Z" fill="${c.hair}"/>`;
  return `
    <g transform="rotate(${LEAN} 50 74)">
    ${line(58, 35, 59, 27, c.skinDark, 6.5)}
    <g transform="translate(61 19) scale(0.86) translate(-63 -23)">
    <circle cx="63" cy="23" r="10.5" fill="${c.skin}"/>
    <path d="M72.5,22 L75.5,26 L72.5,27 Z" fill="${c.skin}"/>
    ${hair}
    <circle cx="60.5" cy="24.5" r="2.6" fill="${c.skinDark}"/>
    <circle cx="69.5" cy="21.5" r="1.3" fill="#1d1612"/>
    <path d="M68,27.5 Q70,28.5 72,27.5" stroke="#1d1612" stroke-width="1" fill="none" stroke-linecap="round"/>
    </g>
    </g>`;
}

// Renvoie le contenu SVG d'un coureur ; gender vaut 'homme' ou 'femme'.
function drawRunner(gender, team) {
  const c = PALETTES[team];
  return `
    <ellipse class="ground" cx="52" cy="134" rx="24" ry="3.2" fill="rgba(0,0,0,0.18)"/>
    <g class="body">
      ${arm('far', c)}
      ${leg('far', gender, c)}
      ${torso(gender, c)}
      ${head(gender, c)}
      ${leg('near', gender, c)}
      ${arm('near', c)}
    </g>`;
}
