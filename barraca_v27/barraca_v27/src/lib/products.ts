export type Category = "pastel" | "caldo" | "bebida" | "outros";

export interface Product {
  id: string;
  name: string;
  price: number;
  category: Category;
  saleable: boolean; // false = stock only, never in expected total
  freeForEmployee?: boolean;
  special?: boolean; // gelo: two consumption fields
  decimal?: boolean; // permite valores decimais nos campos de quantidade (ex: fardo de cana)
}

export const DEFAULT_PRODUCTS: Product[] = [
  // Pastéis comuns R$14
  ...["Carne c/ queijo","Carne","Frango c/ catupiry","Frango c/ queijo","Carioca","Pizza","Palmito","Queijo","4 Queijos","Bauru","Calabresa","Portuguesa"]
    .map((name) => ({ id: `pc_${slug(name)}`, name, price: 14, category: "pastel" as const, saleable: true })),
  // Especiais
  { id: "pe_carneseca", name: "Carne Seca", price: 16, category: "pastel", saleable: true },
  { id: "pe_esp_carneseca", name: "Esp. Carne Seca", price: 22, category: "pastel", saleable: true },
  { id: "pe_esp_carne", name: "Esp. Carne", price: 20, category: "pastel", saleable: true },
  { id: "pe_esp_calabresa", name: "Esp. Calabresa", price: 20, category: "pastel", saleable: true },
  { id: "pe_esp_frango", name: "Esp. Frango", price: 20, category: "pastel", saleable: true },
  // Casquinhas
  { id: "cq_crua", name: "Casquinha crua", price: 0, category: "pastel", saleable: false },
  { id: "cq_frita", name: "Casquinha frita", price: 7, category: "pastel", saleable: true },
  // Caldo de cana
  { id: "cc_fardo", name: "Fardo de cana", price: 0, category: "caldo", saleable: false, decimal: true },
  { id: "cc_300", name: "Copo 300ml", price: 7, category: "caldo", saleable: true },
  { id: "cc_400", name: "Copo 400ml", price: 8, category: "caldo", saleable: true },
  { id: "cc_500", name: "Copo 500ml", price: 9, category: "caldo", saleable: true },
  { id: "cc_g500", name: "Garrafa 500ml", price: 11, category: "caldo", saleable: true },
  { id: "cc_g1000", name: "Garrafa 1L", price: 18, category: "caldo", saleable: true },
  // Bebidas
  { id: "bb_coca", name: "Coca-cola", price: 7, category: "bebida", saleable: true },
  { id: "bb_fantalaranja", name: "Fanta Laranja", price: 7, category: "bebida", saleable: true },
  { id: "bb_fantauva", name: "Fanta Uva", price: 7, category: "bebida", saleable: true },
  { id: "bb_guarana", name: "Guaraná", price: 7, category: "bebida", saleable: true },
  { id: "bb_reflimao", name: "Refri Limão", price: 7, category: "bebida", saleable: true },
  { id: "bb_refzero", name: "Refri Zero", price: 7, category: "bebida", saleable: true },
  { id: "bb_itubaina", name: "Itubaina", price: 7, category: "bebida", saleable: true },
  { id: "bb_agua", name: "Água", price: 4, category: "bebida", saleable: true, freeForEmployee: true },
  { id: "bb_aguagas", name: "Água c/ Gás", price: 5, category: "bebida", saleable: true },
  { id: "bb_cerveja", name: "Cerveja", price: 10, category: "bebida", saleable: true },
  { id: "bb_guaraviton", name: "Guaraviton", price: 7, category: "bebida", saleable: true },
  // Gelo (special) — fica na aba Bebidas
  { id: "ot_gelo", name: "Gelo (pacote)", price: 13, category: "bebida", saleable: true, special: true },
];

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Itens que NÃO entram na soma de "Total de pastéis" (são casquinhas, não pastéis prontos)
export const EXCLUIR_DO_TOTAL_PASTEL = new Set(["cq_crua", "cq_frita"]);
