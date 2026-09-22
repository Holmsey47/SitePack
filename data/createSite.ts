export type CreateSiteInput = {
  name: string;
  mainContractor?: string | null;
  addressLine?: string | null;
  whatItIs?: string | null;
};

export type CreateSiteRow = {
  name: string;
  main_contractor: string | null;
  address_line: string | null;
  what_it_is: string | null;
};

function oneLine(value: string | null | undefined): string | null {
  const text = (value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length ? text : null;
}

export function normalizeCreateSite(input: CreateSiteInput): CreateSiteRow {
  const name = oneLine(input.name);
  if (!name) throw new Error('Name is required');
  return {
    name,
    main_contractor: oneLine(input.mainContractor),
    address_line: oneLine(input.addressLine),
    what_it_is: oneLine(input.whatItIs),
  };
}
