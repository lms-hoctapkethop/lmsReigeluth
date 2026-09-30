# postgres:18 + pgBackRest (≥ 2.56 hỗ trợ PostgreSQL 18; kiểm ghi chú phát hành khi dựng)
FROM postgres:18
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest \
 && chown -R postgres:postgres /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest
