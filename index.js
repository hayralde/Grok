/**
 * Configuração por projeto (área).
 * Cada área tem regras próprias. Alterar uma NÃO afeta as outras.
 * A UI é a mesma; só o comportamento do motor muda conforme CURRENT_AREA.
 */

const AREA_CONFIG = {
  ELETRICA: {
    id: 'ELETRICA',
    label: 'Elétrica',
    labelShort: 'Elétrica',
    // Responsável padrão quando tecnicoTipo não vem no JSON
    defaultTecnicoTipo: 'PESSOA',
    // Se true, permite sobreposição de horários no mesmo rótulo tecnico
    allowOverlap: false,
    // Se true, operador com login vê/marca só as tarefas do seu nome
    operatorLoginRequired: true,
    // Quem pode marcar done além do operador dono
    doneByRoles: ['admin', 'supervisor', 'operador'],
    // Texto de ajuda no painel
    helpText: 'Programação por técnico (pessoa). Sem sobreposição de horários no mesmo operador.',
    // Título do gráfico de horas
    hoursChartTitle: 'Horas por Técnico',
    hoursChartSub: 'Planejado vs. Executado · operadores',
    // Rótulo da coluna no Gantt
    responsibleLabel: 'Técnico',
  },

  MECANICA: {
    id: 'MECANICA',
    label: 'Mecânica',
    labelShort: 'Mecânica',
    defaultTecnicoTipo: 'PESSOA',
    allowOverlap: false,
    operatorLoginRequired: true,
    doneByRoles: ['admin', 'supervisor', 'operador'],
    helpText: 'Programação por técnico (pessoa). Sem sobreposição de horários no mesmo operador.',
    hoursChartTitle: 'Horas por Técnico',
    hoursChartSub: 'Planejado vs. Executado · operadores',
    responsibleLabel: 'Técnico',
  },

  TGM: {
    id: 'TGM',
    label: 'TGM',
    labelShort: 'TGM',
    // Turnos / equipes externas — padrão EQUIPE
    defaultTecnicoTipo: 'EQUIPE',
    allowOverlap: true,
    operatorLoginRequired: false,
    doneByRoles: ['admin', 'supervisor'],
    helpText: 'Programação por turno/equipe (fornecedor externo). Sobreposição no mesmo turno permitida. Conclusão por admin/supervisor.',
    hoursChartTitle: 'Horas por Turno / Equipe',
    hoursChartSub: 'Planejado vs. Executado · sem login do turno',
    responsibleLabel: 'Turno / Equipe',
  },
};

function getAreaConfig(area) {
  const key = String(area || '').toUpperCase();
  return AREA_CONFIG[key] || null;
}

function listAreas() {
  return Object.keys(AREA_CONFIG).map(id => ({
    id,
    label: AREA_CONFIG[id].label,
    labelShort: AREA_CONFIG[id].labelShort,
    defaultTecnicoTipo: AREA_CONFIG[id].defaultTecnicoTipo,
    allowOverlap: AREA_CONFIG[id].allowOverlap,
    helpText: AREA_CONFIG[id].helpText,
    hoursChartTitle: AREA_CONFIG[id].hoursChartTitle,
    hoursChartSub: AREA_CONFIG[id].hoursChartSub,
    responsibleLabel: AREA_CONFIG[id].responsibleLabel,
  }));
}

module.exports = { AREA_CONFIG, getAreaConfig, listAreas };
