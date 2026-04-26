function parseInvoiceText(text) {
  const dupIndex = text.indexOf("DUPLICADO");
  const section = dupIndex !== -1 ? text.substring(0, dupIndex) : text;
  const lines = section.split("\n");

  const result = {
    comprobante: {
      tipo: "",
      codigo: "",
      puntoVenta: "",
      numero: "",
      fechaEmision: ""
    },
    emisor: {
      razonSocial: "",
      cuit: "",
      domicilio: "",
      condicionIva: "",
      ingresosBrutos: "",
      inicioActividades: ""
    },
    receptor: {
      razonSocial: "",
      cuit: "",
      domicilio: "",
      condicionIva: "",
      condicionVenta: ""
    },
    items: [],
    totales: {
      netoGravado: "",
      iva27: "",
      iva21: "",
      iva105: "",
      iva5: "",
      iva25: "",
      iva0: "",
      otrosTributos: "",
      total: ""
    },
    cae: {
      numero: "",
      fechaVencimiento: ""
    }
  };

  try {
    // Invoice type -- "FACTURA" and "A"/"B"/"C" may be on separate lines
    const tipoMatch = section.match(/FACTURA\s+(A|B|C)/i);
    if (tipoMatch) result.comprobante.tipo = tipoMatch[1].toUpperCase();

    // Invoice code
    const codMatch = section.match(/COD\.\s*(\d+)/);
    if (codMatch) result.comprobante.codigo = codMatch[1];

    // Issue date -- first dd/mm/yyyy in the text
    const fechaMatch = section.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (fechaMatch) result.comprobante.fechaEmision = fechaMatch[1];

    // Punto de Venta and Comp. Nro -- pdf-parse concatenates them as 13 digits
    // e.g. "Punto de Venta:Comp. Nro:\n0000100003726"
    const pvMatch = section.match(/Punto de Venta:.*?Nro:?\s*(\d{5})(\d{8})/s);
    if (pvMatch) {
      result.comprobante.puntoVenta = pvMatch[1];
      result.comprobante.numero = pvMatch[2];
    }

    // CUITs -- exactly 11 digits, not part of larger digit sequences (13-digit PV+Nro, 14-digit CAE)
    const cuits = [];
    const cuitRegex = /(?<!\d)(\d{11})(?!\d)/g;
    let cuitMatch;
    while ((cuitMatch = cuitRegex.exec(section)) !== null) {
      cuits.push({ value: cuitMatch[1], index: cuitMatch.index });
    }

    if (cuits.length >= 1) result.emisor.cuit = cuits[0].value;

    // Receptor CUIT -- second 11-digit number (may be concatenated with name, e.g. "30715038508MASAMADRE SA")
    if (cuits.length >= 2) {
      result.receptor.cuit = cuits[1].value;
      const cuitLine = lines.find(l => l.includes(cuits[1].value));
      if (cuitLine) {
        const afterCuit = cuitLine.substring(cuitLine.indexOf(cuits[1].value) + 11).trim();
        if (afterCuit) result.receptor.razonSocial = afterCuit;
      }
    }

    // Emisor razon social -- line after "ORIGINAL"
    const originalMatch = section.match(/ORIGINAL\s*\n([^\n]+)/);
    if (originalMatch) {
      result.emisor.razonSocial = originalMatch[1].trim();
    }

    // Emisor domicilio -- lines after razon social, stop at label keywords
    if (result.emisor.razonSocial) {
      const idx = lines.findIndex(l => l.trim() === result.emisor.razonSocial);
      if (idx >= 0) {
        const domLines = [];
        for (let i = idx + 1; i < lines.length; i++) {
          const l = lines[i].trim();
          if (!l || /^(CUIT|Condición|Apellido|Domicilio)/.test(l)) break;
          domLines.push(l);
        }
        if (domLines.length) result.emisor.domicilio = domLines.join(", ");
      }
    }

    // Receptor domicilio -- line after the CUIT+razonSocial line
    if (cuits.length >= 2) {
      const cuitLineIdx = lines.findIndex(l => l.includes(cuits[1].value));
      if (cuitLineIdx >= 0 && cuitLineIdx + 1 < lines.length) {
        const nextLine = lines[cuitLineIdx + 1].trim();
        if (nextLine && !/^(Cuenta|Contado|Tarjeta|Cheque|CUIT|Condición|Ingresos|Fecha de Inicio)/.test(nextLine)) {
          result.receptor.domicilio = nextLine;
        }
      }
    }

    // IVA conditions
    const ivaConditions = section.match(
      /IVA\s+Responsable\s+Inscripto|Responsable\s+Monotributo|Consumidor\s+Final|Monotributo|Exento|No\s+Responsable/gi
    ) || [];
    if (ivaConditions.length >= 1) result.emisor.condicionIva = ivaConditions[0].trim();
    if (ivaConditions.length >= 2) result.receptor.condicionIva = ivaConditions[1].trim();

    // Condicion de venta -- search for known payment condition keywords
    const condVentaMatch = section.match(
      /\b(Cuenta Corriente|Contado|Tarjeta de [A-Za-záéíóúñÁÉÍÓÚÑ]+|Cheque|Otra|Cr[eé]dito|D[eé]bito)\b/i
    );
    if (condVentaMatch) result.receptor.condicionVenta = condVentaMatch[0].trim();

    // Ingresos Brutos and Inicio Actividades --
    // In AFIP PDFs, the labels appear separately from values due to two-column layout.
    // After the last IVA condition, the next date is inicioActividades and the next
    // 11-digit number is ingresosBrutos.
    if (ivaConditions.length >= 2) {
      const lastIvaText = ivaConditions[ivaConditions.length - 1];
      const lastIvaIdx = section.lastIndexOf(lastIvaText);
      if (lastIvaIdx >= 0) {
        const afterLastIva = section.substring(lastIvaIdx + lastIvaText.length);
        const iaDateMatch = afterLastIva.match(/(\d{2}\/\d{2}\/\d{4})/);
        if (iaDateMatch) result.emisor.inicioActividades = iaDateMatch[1];
        const ibMatch = afterLastIva.match(/(?<!\d)(\d{11})(?!\d)/);
        if (ibMatch) result.emisor.ingresosBrutos = ibMatch[1];
      }
    }

    // Items -- text between "Subtotal c/IVA" header and "CAE"
    parseItems(section, result);

    // Totals
    result.totales.netoGravado = extractAmount(section, /Importe Neto Gravado:\s*\$\s*([\d.,]+)/i);
    result.totales.iva27 = extractAmount(section, /IVA 27%:\s*\$\s*([\d.,]+)/i);
    result.totales.iva21 = extractAmount(section, /IVA 21%:\s*\$\s*([\d.,]+)/i);
    result.totales.iva105 = extractAmount(section, /IVA 10\.?5%:\s*\$\s*([\d.,]+)/i);
    result.totales.iva5 = extractAmount(section, /IVA 5%:\s*\$\s*([\d.,]+)/i);
    result.totales.iva25 = extractAmount(section, /IVA 2\.?5%:\s*\$\s*([\d.,]+)/i);
    result.totales.iva0 = extractAmount(section, /IVA 0%:\s*\$\s*([\d.,]+)/i);
    result.totales.otrosTributos = extractAmount(section, /Importe Otros Tributos:\s*\$\s*([\d.,]+)/i);
    result.totales.total = extractAmount(section, /Importe Total:\s*\$\s*([\d.,]+)/i);

    // CAE number (14 digits)
    const caeNumMatch = section.match(/(?<!\d)(\d{14})(?!\d)/);
    if (caeNumMatch) result.cae.numero = caeNumMatch[1];

    // CAE expiration date -- may have multiple lines between label and value
    const caeVtoMatch = section.match(/Fecha de Vto\.?\s*de CAE:[\s\S]*?(\d{2}\/\d{2}\/\d{4})/i);
    if (caeVtoMatch) result.cae.fechaVencimiento = caeVtoMatch[1];
  } catch (e) {
    console.error("Error parsing invoice text:", e);
  }

  return result;
}

function parseItems(section, result) {
  const headerMatch = section.match(/Subtotal c\/IVA\s*\n/i);
  const caeMatch = section.match(/\nCAE\s/i);
  if (!headerMatch || !caeMatch) return;

  const itemsBlock = section
    .substring(headerMatch.index + headerMatch[0].length, caeMatch.index)
    .trim();
  if (!itemsBlock) return;

  const fullText = itemsBlock.replace(/\n/g, " ");

  // Split items by finding unit-of-measure keywords
  const unitWords =
    "unidades|unidad|kilogramos|kilogramo|kilos|kilo|kg|litros|litro|lt|metros|metro|gramos|gramo|gr|paquetes|paquete|cajas|caja|docenas|docena";
  const unitRegex = new RegExp(`\\b(${unitWords})\\b`, "gi");

  const unitMatches = [];
  let um;
  while ((um = unitRegex.exec(fullText)) !== null) {
    unitMatches.push({ word: um[1], index: um.index, end: um.index + um[0].length });
  }

  if (unitMatches.length === 0) return;

  let currentStart = 0;
  for (let i = 0; i < unitMatches.length; i++) {
    const unitInfo = unitMatches[i];
    const beforeUnit = fullText.substring(currentStart, unitInfo.index).trim();

    // Find the end of this item: IVA% marker + final amount after it
    const afterUnitStart = unitInfo.end;
    const remainingText = fullText.substring(afterUnitStart);
    const ivaPercentMatch = remainingText.match(/(\d+)%/);

    let itemEnd;
    if (ivaPercentMatch) {
      const afterPercentStart = ivaPercentMatch.index + ivaPercentMatch[0].length;
      const afterPercent = remainingText.substring(afterPercentStart);
      const finalAmountMatch = afterPercent.match(/^([\d.,]+)/);
      itemEnd = afterUnitStart + afterPercentStart + (finalAmountMatch ? finalAmountMatch[0].length : 0);
    } else {
      itemEnd = fullText.length;
    }

    const afterUnit = fullText.substring(afterUnitStart, itemEnd).trim();
    currentStart = itemEnd;

    // Extract decimal amounts (XX,XX) from the after-unit part
    const amounts = afterUnit.match(/\d+,\d{2}/g) || [];
    const alicuotaMatch = afterUnit.match(/(10[.,]5|2[.,]5|27|21|5|0)%/);

    const precioUnitario = amounts[0] || "";
    const bonificacion = amounts[1] || "";
    const subtotal = amounts[2] || "";
    const alicuotaIva = alicuotaMatch ? alicuotaMatch[1] + "%" : "";
    const subtotalConIva = amounts[3] || "";

    // Split product name from quantity using cross-validation:
    // cantidad = subtotal / precioUnitario, then find that number in the beforeUnit text
    let producto = beforeUnit;
    let cantidad = "";

    const precioNum = parseArgNumber(precioUnitario);
    const subtotalNum = parseArgNumber(subtotal);

    if (precioNum > 0 && subtotalNum > 0) {
      const bonifNum = parseArgNumber(bonificacion);
      const factor = bonifNum > 0 ? (1 - bonifNum / 100) : 1;
      const expectedCant = subtotalNum / (precioNum * factor);
      const cantStr = formatArgNumber(expectedCant);

      const cantIdx = beforeUnit.lastIndexOf(cantStr);
      if (cantIdx > 0) {
        producto = beforeUnit.substring(0, cantIdx).trim();
        cantidad = cantStr;
      }
    }

    // Fallback: if cross-validation didn't split, try finding the last decimal number
    if (!cantidad) {
      const cantFallback = beforeUnit.match(/^(.*\D)(\d+,\d{2})$/);
      if (cantFallback) {
        producto = cantFallback[1].trim();
        cantidad = cantFallback[2];
      }
    }

    result.items.push({
      producto,
      cantidad,
      unidadMedida: unitInfo.word,
      precioUnitario,
      bonificacion,
      subtotal,
      alicuotaIva,
      subtotalConIva
    });
  }
}

function extractAmount(text, regex) {
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

function parseArgNumber(str) {
  if (!str) return 0;
  return parseFloat(str.replace(/\./g, "").replace(",", "."));
}

function formatArgNumber(num) {
  return num.toFixed(2).replace(".", ",");
}

module.exports = parseInvoiceText;
