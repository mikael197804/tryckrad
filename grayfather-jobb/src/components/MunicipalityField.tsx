"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { filterMunicipalities } from "@/lib/municipalities";

type Props = {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowAllSweden?: boolean;
  required?: boolean;
};

export function MunicipalityField({
  id,
  label,
  value,
  onChange,
  allowAllSweden = false,
  required = false,
}: Props) {
  const [query, setQuery] = useState(value);
  const deferred = useDeferredValue(query);

  useEffect(() => {
    setQuery(value);
  }, [value]);
  const options = useMemo(() => {
    const matches = filterMunicipalities(deferred, 14);
    if (allowAllSweden) {
      return ["Hela Sverige", ...matches.filter((m) => m !== "Hela Sverige")];
    }
    return matches;
  }, [allowAllSweden, deferred]);

  return (
    <label className="muni-field">
      {label}
      <input
        id={id}
        list={id ? `${id}-list` : undefined}
        required={required && !allowAllSweden}
        minLength={allowAllSweden ? 0 : 2}
        maxLength={120}
        value={query}
        placeholder={allowAllSweden ? "Hela Sverige eller kommun" : "Skriv kommun"}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          onChange(next);
        }}
        onBlur={() => {
          if (allowAllSweden && query.trim() === "") {
            setQuery("Hela Sverige");
            onChange("Hela Sverige");
          }
        }}
      />
      <datalist id={id ? `${id}-list` : undefined}>
        {options.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </label>
  );
}
