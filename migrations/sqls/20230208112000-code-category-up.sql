UPDATE former22_course
SET
    `codeCategory` = case `codeCategory`
        when 'Catalogue' then 'CAT'
        when 'CAS' then 'CERTIF'
    end
WHERE
    `codeCategory` IN ('Catalogue', 'CAS');
