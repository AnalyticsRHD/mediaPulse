import { Injectable } from '@nestjs/common';

export type BrandMapping = {
  cliente: string;
  marca: string;
};

@Injectable()
export class BrandMappingService {
  private mappings: BrandMapping[] = [
    { cliente: 'WORLD SPORT', marca: 'Quiksilver' },
    { cliente: 'WORLD SPORT', marca: 'DC' },
    { cliente: 'WORLD SPORT', marca: 'Ala Moana' },
    { cliente: 'WORLD SPORT', marca: 'Roxy' },
    { cliente: 'WORLD SPORT', marca: 'RVCA' },
    { cliente: 'WORLD SPORT', marca: 'Boardriders' },
    { cliente: 'FRESH UP', marca: 'Care Up' },
    { cliente: 'FRESH UP', marca: 'Fresh Up' },
    { cliente: 'LP', marca: 'LP' },
    { cliente: 'ORMIFLEX', marca: 'Ormiflex' },
    { cliente: 'PAMPA BAY', marca: 'Pampa Bay' },
    { cliente: 'BINDER RULEMANES', marca: 'Binder' },
    { cliente: 'ZONA FRANCA', marca: 'As Automotores' },
    { cliente: 'ZONA FRANCA', marca: 'Zona Franca' },
    { cliente: 'TV5', marca: 'TV5' },
    { cliente: 'IMQ', marca: 'Imq' },
    { cliente: 'CASA BACHETTII ZANOTTI', marca: 'Casa Bachettii' },
    { cliente: 'MEDNET', marca: 'Mednet' },
    { cliente: 'LONDON', marca: 'DF_AS_Ushuaia' },
    { cliente: 'LONDON', marca: 'DF_AS_Rio Grande' },
    { cliente: 'LONDON', marca: 'DF_Patagonia_Shops' },
    { cliente: 'LONDON', marca: 'DF_Puerto Iguazú' },
    { cliente: 'LONDON', marca: 'Maria Taratuty' },
    { cliente: 'LONDON', marca: 'London Inst.' },
    { cliente: 'LONDON', marca: 'London Fundación' },
    { cliente: 'RHD', marca: 'Rhd' }
  ];

  getAll(): BrandMapping[] {
    return this.mappings;
  }

  getClients(): string[] {
    return Array.from(new Set(this.mappings.map((item) => item.cliente))).sort();
  }

  getBrandsByClient(cliente: string): string[] {
    const normalizedClient = this.normalize(cliente);

    return this.mappings
      .filter((item) => this.normalize(item.cliente) === normalizedClient)
      .map((item) => item.marca)
      .sort();
  }

  resolveClientBrand(cliente: string, marca: string): BrandMapping {
    const normalizedClient = this.normalize(cliente);
    const normalizedBrand = this.normalize(marca);
    const exact = this.mappings.find((item) => (
      this.normalize(item.cliente) === normalizedClient
      && this.normalize(item.marca) === normalizedBrand
    ));

    if (exact) return exact;

    const byBrand = this.resolve(marca);
    if (byBrand.cliente !== 'SIN MAPEO') return byBrand;

    return {
      cliente: cliente.trim(),
      marca: marca.trim()
    };
  }

  resolve(reference: string): BrandMapping {
    const normalizedReference = this.normalize(reference);
    const exact = this.mappings.find((item) => this.normalize(item.marca) === normalizedReference);
    if (exact) return exact;

    const contained = this.mappings.find((item) => {
      const brand = this.normalize(item.marca);
      return normalizedReference.includes(brand) || brand.includes(normalizedReference);
    });
    if (contained) return contained;

    return {
      cliente: 'SIN MAPEO',
      marca: this.toTitleCase(reference || 'Sin referencia')
    };
  }

  normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[_\s]+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private toTitleCase(value: string): string {
    return value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
}
