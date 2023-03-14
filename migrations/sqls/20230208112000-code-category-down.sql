UPDATE former22_course
SET
    `codeCategory` = case `codeCategory`
        when 'CAT' then 'Catalogue'
        when 'CERTIF' then 'CAS'
    end
WHERE
    `codeCategory` IN ('CAT', 'CERTIF');
