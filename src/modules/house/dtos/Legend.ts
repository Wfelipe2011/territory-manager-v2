export class LegengDTO {
  static mapper(legend: string | null): '' | 'CM' | 'TR' | 'FD' | 'TJ' | 'IG' | 'ES' | 'HP' | 'AP' {
    if (!legend) return '';
    const legendMap: { [key: string]: '' | 'CM' | 'TR' | 'FD' | 'TJ' | 'IG' | 'ES' | 'HP' | 'AP' } = {
      Comércio: 'CM',
      Residência: '',
      Terreno: 'TR',
      Fundos: 'FD',
      'Testemunha de Jeová': 'TJ',
      Igreja: 'IG',
      Escola: 'ES',
      Hospital: 'HP',
      Apartamento: 'AP',
    };
    return legendMap[legend] || '';
  }
}
