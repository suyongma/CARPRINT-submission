-- SELECT FOR SHARE에는 UPDATE 권한이 필요하므로 API에 자격 수정 권한을 주지 않는다.
-- 고정 검색 경로/정적 SQL의 최소 함수만 소유자 권한으로 잠금 조회한다.
CREATE FUNCTION identity.active_mechanic(target_principal uuid, at_time timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM identity.mechanic_credential c JOIN identity.principal p USING(principal_id)
 WHERE c.principal_id=target_principal AND p.role='maintenance_issuer' AND p.revoked_at IS NULL
 AND c.valid_from<=at_time AND c.valid_until>at_time AND c.revoked_at IS NULL FOR SHARE OF c,p;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION identity.active_mechanic(uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.active_mechanic(uuid,timestamptz) TO carprint_api;
