import { Link, useLocation } from 'react-router-dom';

const CONTACT_EMAIL = 'breakout.pro.tv@gmail.com';

const LEGAL_CONTENT = {
  cgu: {
    title: "Conditions Générales d'Utilisation",
    intro:
      "Ces Conditions Générales d'Utilisation encadrent l'accès à Breakout Trading Fight, plateforme de démonstration, de compétition et de paper trading.",
    sections: [
      {
        title: 'Objet du service',
        body:
          "Breakout Trading Fight propose des interfaces de suivi de trading, de compétition et de simulation. Sauf mention contraire explicite, les fonctionnalités de paper trading n'impliquent aucun ordre réel, aucun dépôt et aucun retrait.",
      },
      {
        title: 'Accès utilisateur',
        body:
          "L'utilisateur s'engage à fournir des informations exactes lors de son inscription et à ne pas contourner les mécanismes de vérification, notamment l'email et le téléphone lorsqu'ils sont demandés.",
      },
      {
        title: 'Comportements interdits',
        body:
          "Sont interdits : multi-comptes frauduleux, tentative d'accès non autorisé, manipulation de leaderboard, automatisation abusive, attaque du service ou usage contraire aux lois applicables.",
      },
      {
        title: 'Compétitions',
        body:
          "Les règles propres à chaque compétition, durée, classement, prix éventuel et critères de participation peuvent varier. Toute participation implique l'acceptation des règles affichées pour la compétition concernée.",
      },
      {
        title: 'Disponibilité',
        body:
          "La plateforme peut être modifiée, suspendue ou interrompue pour maintenance, évolution produit, incident technique ou raison de sécurité.",
      },
    ],
  },
  confidentialite: {
    title: 'Politique de confidentialité',
    intro:
      'Cette page explique les données susceptibles d’être utilisées pour faire fonctionner la plateforme et sécuriser les inscriptions.',
    sections: [
      {
        title: 'Données collectées',
        body:
          "Selon les fonctionnalités utilisées, la plateforme peut traiter : email, pseudo, numéro de téléphone de vérification, identifiants de session, participation aux compétitions et performances de paper trading.",
      },
      {
        title: 'Finalités',
        body:
          "Ces données servent à authentifier les utilisateurs, prévenir le multi-compte, afficher les leaderboards, sécuriser l'accès et améliorer l'expérience produit.",
      },
      {
        title: 'Services tiers',
        body:
          "Des prestataires peuvent être utilisés pour l'envoi d'emails transactionnels, la vérification SMS, l'hébergement, les analytics techniques ou l'affichage de graphiques.",
      },
      {
        title: 'Conservation',
        body:
          "Les données sont conservées pendant une durée proportionnée au fonctionnement du service, à la sécurité et aux obligations légales éventuelles.",
      },
      {
        title: 'Contact et droits',
        body:
          `Pour toute demande liée aux données personnelles, contactez ${CONTACT_EMAIL}.`,
      },
    ],
  },
  mentions: {
    title: 'Mentions légales',
    intro:
      'Informations générales relatives à Breakout Trading Fight.',
    sections: [
      {
        title: 'Éditeur',
        body:
          'Breakout Trading Fight by BLOCKS. Les informations juridiques complètes de la structure éditrice pourront être complétées avant ouverture publique commerciale.',
      },
      {
        title: 'Contact',
        body:
          `Email de contact : ${CONTACT_EMAIL}.`,
      },
      {
        title: 'Hébergement',
        body:
          "L'hébergement peut être assuré par les prestataires techniques utilisés pour le frontend, le backend, les bases de données et les services associés.",
      },
      {
        title: 'Propriété intellectuelle',
        body:
          "Les interfaces, textes, éléments graphiques, marques, logos et contenus propres à Breakout Trading Fight ne peuvent pas être réutilisés sans autorisation.",
      },
    ],
  },
  risques: {
    title: 'Avertissement sur les risques',
    intro:
      "Le trading comporte des risques importants. Cette plateforme peut afficher des performances simulées ou réelles selon le mode utilisé.",
    sections: [
      {
        title: 'Paper trading',
        body:
          "Les résultats en paper trading sont simulés. Ils ne constituent pas une performance réelle et ne garantissent aucun résultat futur.",
      },
      {
        title: 'Marchés financiers et crypto-actifs',
        body:
          "Les crypto-actifs et produits financiers peuvent être très volatils. Une perte partielle ou totale du capital est possible dans un environnement de trading réel.",
      },
      {
        title: 'Absence de conseil financier',
        body:
          "Les informations affichées sur la plateforme ne constituent ni un conseil en investissement, ni une recommandation d'achat ou de vente.",
      },
      {
        title: 'Responsabilité utilisateur',
        body:
          "Chaque utilisateur reste responsable de ses décisions, de sa gestion du risque et du respect de la réglementation applicable dans son pays.",
      },
    ],
  },
};

type LegalPageType = keyof typeof LEGAL_CONTENT;

export function LegalPage({ type }: { type: LegalPageType }) {
  const content = LEGAL_CONTENT[type];
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const from = params.get('from');
  const backLink = from === 'compete'
    ? { to: '/compete', label: 'Retour à BTF Arena' }
    : { to: '/compete', label: 'Retour à BTF Arena' };

  return (
    <main className="min-h-screen bg-[#050506] px-5 pb-24 pt-10 text-white">
      <div className="mx-auto max-w-4xl">
        <Link to={backLink.to} className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-300 transition-colors hover:text-red-200">
          {backLink.label}
        </Link>

        <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.035] p-6 shadow-2xl shadow-black/40 md:p-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8f96a3]">Breakout Trading Fight</p>
          <h1 className="mt-3 font-rajdhani text-4xl font-bold tracking-tight text-white md:text-5xl">{content.title}</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[#b8bdc9]">{content.intro}</p>

          <div className="mt-8 space-y-5">
            {content.sections.map((section) => (
              <article key={section.title} className="rounded-2xl border border-white/8 bg-black/25 p-5">
                <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-red-200">{section.title}</h2>
                <p className="mt-3 text-sm leading-7 text-[#d7dae3]">{section.body}</p>
              </article>
            ))}
          </div>

          <p className="mt-8 text-xs leading-6 text-[#8f96a3]">
            Version de travail à faire relire par un professionnel du droit avant lancement commercial public.
          </p>
        </section>
      </div>
    </main>
  );
}
